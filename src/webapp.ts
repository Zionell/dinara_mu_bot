import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import type { Api } from "grammy";
import { config } from "./config.js";
import { SERVICES, type ServiceKey } from "./data/services.js";
import { reportError } from "./logger.js";
import { getFreeSlotsByDay, isSlotAvailable } from "./services/slots.js";
import { formatTime, upcomingDateKeys } from "./time.js";
import { continueWithTime, sessionStore, type SessionData } from "./bot.js";

/**
 * Mini App с календарём записи: страница /app/ и API /api/slots, /api/pick.
 * Mini App открывается кнопкой из чата; выбранное время возвращается в обычный поток бота
 * (имя → телефон → подтверждение или подтверждение переноса).
 */

const APP_PATH = "/app/";
/** initData старше этого — просим открыть календарь заново. */
const INIT_DATA_TTL_SEC = 24 * 60 * 60;

const html = fs.readFileSync(new URL("../webapp/index.html", import.meta.url), "utf8");

/** Адрес Mini App для текущего шага записи; undefined — Mini App недоступен (нет https). */
export function webAppUrl(session: SessionData): string | undefined {
  if (!config.webAppUrl || !session.service) return undefined;
  // Услуга в адресе — чтобы кнопка из старого сообщения не выбрала время для другой услуги
  const params = new URLSearchParams({ s: session.service });
  if (session.rescheduleId) params.set("r", String(session.rescheduleId));
  return `${config.webAppUrl}?${params}`;
}

/** Проверка подписи initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
function verifyInitData(initData: string): { id: number } | undefined {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return undefined;
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (hash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) {
    return undefined;
  }
  if (Date.now() / 1000 - Number(params.get("auth_date")) > INIT_DATA_TTL_SEC) return undefined;
  try {
    const user = JSON.parse(params.get("user") ?? "");
    return typeof user?.id === "number" ? { id: user.id } : undefined;
  } catch {
    return undefined;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Пользователь из initData и его сессия; сессия должна быть на шаге выбора времени для этой услуги. */
async function authorize(req: http.IncomingMessage, url: URL) {
  const auth = req.headers.authorization ?? "";
  const user = auth.startsWith("tma ") ? verifyInitData(auth.slice(4)) : undefined;
  if (!user) throw new HttpError(401, "unauthorized");

  const key = String(user.id);
  const session = await sessionStore.read(key);
  const service = url.searchParams.get("s");
  const rescheduleId = url.searchParams.get("r");
  if (
    !session?.service ||
    session.service !== service ||
    String(session.rescheduleId ?? "") !== (rescheduleId ?? "") ||
    session.step !== "idle"
  ) {
    throw new HttpError(409, "expired");
  }
  return { chatId: user.id, key, session, service: session.service as ServiceKey };
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new HttpError(413, "too_large");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

async function getSlots(req: http.IncomingMessage, url: URL) {
  const { session, service } = await authorize(req, url);
  const keys = upcomingDateKeys(config.bookingDaysAhead);
  const byDay = await getFreeSlotsByDay(keys, service, session.rescheduleId);
  const days: Record<string, { t: number; label: string }[]> = {};
  for (const [dateKey, slots] of byDay) {
    if (slots.length) days[dateKey] = slots.map((s) => ({ t: s.getTime(), label: formatTime(s) }));
  }
  return {
    service: SERVICES[service].title,
    reschedule: Boolean(session.rescheduleId),
    firstOpen: keys[0],
    lastOpen: keys[keys.length - 1],
    days,
  };
}

async function pick(api: Api, req: http.IncomingMessage, url: URL) {
  const { chatId, key, session, service } = await authorize(req, url);
  const start = Number((await readJson(req))?.start);
  if (!Number.isSafeInteger(start)) throw new HttpError(400, "bad_start");
  if (!(await isSlotAvailable(new Date(start), service, session.rescheduleId))) throw new HttpError(409, "gone");

  const messageId = session.calendarMsgId;
  delete session.calendarMsgId;
  // «Другое время» — снова к сообщению с кнопкой календаря
  await continueWithTime(api, chatId, session, start, { messageId, otherTime: "months" });
  await sessionStore.write(key, session);
  return { ok: true };
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

/** Обрабатывает запросы Mini App; возвращает false, если запрос не к нему. */
export function handleWebApp(api: Api, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === APP_PATH) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(html);
    return true;
  }

  const route =
    req.method === "GET" && url.pathname === "/api/slots"
      ? () => getSlots(req, url)
      : req.method === "POST" && url.pathname === "/api/pick"
        ? () => pick(api, req, url)
        : undefined;
  if (!route) return false;

  route()
    .then((data) => sendJson(res, 200, data))
    .catch((err) => {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code });
      reportError(`Mini App ${url.pathname}`, err);
      sendJson(res, 500, { error: "server" });
    });
  return true;
}
