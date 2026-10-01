import http from "node:http";
import { webhookCallback } from "grammy";
import { config } from "./config.js";
import { createBot } from "./bot.js";
import { isDbAlive, migrateDb, pool } from "./db/index.js";
import { MASTER_TEXTS } from "./data/master.js";
import { TEXTS } from "./data/texts.js";
import { initAlerts, reportError } from "./logger.js";
import { startScheduler } from "./scheduler.js";
import { handleWebApp } from "./webapp.js";

const WEBHOOK_PATH = "/telegram";

async function main() {
  await migrateDb();
  console.log("PostgreSQL подключена, миграции применены");

  if (!config.google) console.warn("Google Calendar не настроен — события в календарь создаваться не будут");
  if (!config.masterChatId) console.warn("MASTER_CHAT_ID не задан — мастер не будет получать уведомления");
  if (!config.adminChatId) console.warn("ADMIN_CHAT_ID не задан — алерты об ошибках только в логах");

  const bot = createBot();
  initAlerts(bot.api);
  const commands = Object.entries(TEXTS.commands).map(([command, description]) => ({ command, description }));
  await bot.api.setMyCommands(commands);
  // У мастера своё меню команд: записи и отзывы
  if (config.masterChatId) {
    const masterCommands = Object.entries(MASTER_TEXTS.commands).map(([command, description]) => ({ command, description }));
    await bot.api
      .setMyCommands(masterCommands, {
        scope: { type: "chat", chat_id: config.masterChatId },
      })
      .catch(() => {}); // чат ещё не открыт — ниже будет предупреждение
  }

  // Бот может писать человеку только после того, как тот сам нажал /start
  for (const [name, chatId] of [
    ["MASTER_CHAT_ID", config.masterChatId],
    ["ADMIN_CHAT_ID", config.adminChatId],
  ] as const) {
    if (!chatId) continue;
    await bot.api.getChat(chatId).catch(() =>
      console.warn(
        `⚠️  ${name}=${chatId}: бот не может писать в этот чат. ` +
          "Этот человек должен открыть бота и нажать /start (или проверьте ID).",
      ),
    );
  }

  const stopScheduler = startScheduler(bot.api);

  // HTTP: healthcheck + (в режиме webhook) приём апдейтов от Telegram
  const handleUpdate = config.webhookUrl
    ? webhookCallback(bot, "http", {
        secretToken: config.webhookSecret,
        // Долгий апдейт (Google Calendar) дорабатывает в фоне, а Telegram сразу получает 200
        // и не присылает тот же апдейт повторно
        onTimeout: "return",
        timeoutMilliseconds: 8_000,
      })
    : undefined;
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      void isDbAlive().then((ok) =>
        res.writeHead(ok ? 200 : 503, { "Content-Type": "text/plain" }).end(ok ? "ok" : "db down"),
      );
      return;
    }
    if (handleWebApp(bot.api, req, res)) return;
    if (handleUpdate && req.method === "POST" && req.url === WEBHOOK_PATH) {
      handleUpdate(req, res).catch((err) => {
        reportError("Webhook", err);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(config.port, () => console.log(`HTTP-сервер на порту ${config.port}`));

  if (config.webhookUrl) {
    await bot.init();
    await bot.api.setWebhook(config.webhookUrl + WEBHOOK_PATH, {
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query"],
    });
    console.log(`Бот @${bot.botInfo.username} запущен (webhook)`);
  } else {
    void bot.start({
      allowed_updates: ["message", "callback_query"],
      onStart: (me) => console.log(`Бот @${me.username} запущен (long polling)`),
    });
  }

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: останавливаюсь...`);
    stopScheduler();
    server.close();
    if (!config.webhookUrl) await bot.stop();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

process.on("unhandledRejection", (err) => reportError("Unhandled rejection", err));
process.on("uncaughtException", (err) => {
  reportError("Uncaught exception — перезапуск", err);
  // Даём алерту уйти, затем падаем — Docker перезапустит контейнер
  setTimeout(() => process.exit(1), 2000);
});

main().catch((err) => {
  reportError("Запуск", err);
  setTimeout(() => process.exit(1), 2000);
});
