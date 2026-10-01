import type { Api } from "grammy";
import { config } from "./config.js";

let alertApi: Api | undefined;
const lastAlertAt = new Map<string, number>();
const ALERT_THROTTLE_MS = 60_000;

/** Включить отправку алертов об ошибках в Telegram (ADMIN_CHAT_ID). */
export function initAlerts(api: Api) {
  alertApi = api;
}

/** Ошибка отправки уведомления мастеру — только в лог, без алерта в Telegram. */
export function logNotifyError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const hint = msg.includes("chat not found") || msg.includes("403")
    ? " — проверьте MASTER_CHAT_ID и что мастер нажал /start в боте (узнать ID: /myid)"
    : "";
  console.error(`[${new Date().toISOString()}] Уведомление мастеру не отправлено: ${msg}${hint}`);
}

/** Залогировать ошибку и (не чаще раза в минуту на одно место) прислать алерт админу. */
export function reportError(where: string, err: unknown) {
  console.error(`[${new Date().toISOString()}] ${where}:`, err);
  if (!alertApi || !config.adminChatId) return;

  const now = Date.now();
  if (now - (lastAlertAt.get(where) ?? 0) < ALERT_THROTTLE_MS) return;
  lastAlertAt.set(where, now);

  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  const text = `⚠️ <b>${escape(where)}</b>\n<pre>${escape(message.slice(0, 3500))}</pre>`;
  alertApi.sendMessage(config.adminChatId, text, { parse_mode: "HTML" }).catch(() => {});
}

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
