import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import { config } from "../config.js";
import { MASTER_TEXTS } from "../data/master.js";
import { reportError } from "../logger.js";
import type { Booking } from "../db/schema.js";
import { zonedToUtc } from "../time.js";

let client: calendar_v3.Calendar | undefined;

function getClient(): calendar_v3.Calendar | undefined {
  if (!config.google) return undefined;
  if (!client) {
    const jwt = new auth.JWT({
      email: config.google.email,
      key: config.google.privateKey,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    client = calendar({ version: "v3", auth: jwt });
  }
  return client;
}

function describe(b: Booking): string {
  return MASTER_TEXTS.calendarEvent.description({
    name: b.name,
    phone: b.phone,
    telegram: b.telegramUsername ? `@${b.telegramUsername}` : `id ${b.telegramId}`,
    comment: b.comment ?? undefined,
    photos: b.photos?.length ?? 0,
  });
}

export async function createCalendarEvent(booking: Booking): Promise<string | undefined> {
  const cal = getClient();
  if (!cal || !config.google) return undefined;

  const { data } = await cal.events.insert({
    calendarId: config.google.calendarId,
    requestBody: {
      summary: MASTER_TEXTS.calendarEvent.summary(booking.serviceTitle, booking.name),
      description: describe(booking),
      start: { dateTime: booking.start.toISOString(), timeZone: config.timezone },
      end: { dateTime: booking.end.toISOString(), timeZone: config.timezone },
      // Помечаем события бота, чтобы не считать их «личной занятостью» (записи и так в БД)
      extendedProperties: { private: { bookingId: String(booking.id) } },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 24 * 60 },
          { method: "popup", minutes: 60 },
        ],
      },
    },
  });
  return data.id ?? undefined;
}

export async function moveCalendarEvent(eventId: string, start: Date, end: Date): Promise<void> {
  const cal = getClient();
  if (!cal || !config.google) return;
  await cal.events.patch({
    calendarId: config.google.calendarId,
    eventId,
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: config.timezone },
      end: { dateTime: end.toISOString(), timeZone: config.timezone },
    },
  });
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const cal = getClient();
  if (!cal || !config.google) return;
  await cal.events.delete({ calendarId: config.google.calendarId, eventId });
}

// ---------- Занятость из календаря ----------

export interface Interval {
  start: number;
  end: number;
}

const CACHE_TTL_MS = 60_000;
let cache: { from: number; to: number; at: number; items: Interval[] } | undefined;

/**
 * Занятое время в календаре мастера (личные дела, записи вне бота, выходные).
 * Учитываются события со статусом «Занят»; события, созданные ботом, пропускаются.
 * Событие на весь день со статусом «Занят» закрывает весь день.
 * При ошибке Google API возвращает [] (запись не блокируется) и шлёт алерт.
 */
export async function getCalendarBusy(from: Date, to: Date, { fresh = false } = {}): Promise<Interval[]> {
  const cal = getClient();
  if (!cal || !config.google) return [];

  const f = from.getTime();
  const t = to.getTime();
  if (!fresh && cache && cache.from <= f && cache.to >= t && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items.filter((i) => i.start < t && i.end > f);
  }

  try {
    const items: Interval[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await cal.events.list({
        calendarId: config.google.calendarId,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
        maxResults: 2500,
        pageToken,
        fields: "nextPageToken,items(id,status,transparency,start,end,extendedProperties)",
      });
      for (const e of data.items ?? []) {
        if (e.status === "cancelled" || e.transparency === "transparent") continue;
        if (e.extendedProperties?.private?.bookingId) continue;
        const start = e.start?.dateTime ? Date.parse(e.start.dateTime) : e.start?.date ? zonedToUtc(e.start.date, 0).getTime() : NaN;
        const end = e.end?.dateTime ? Date.parse(e.end.dateTime) : e.end?.date ? zonedToUtc(e.end.date, 0).getTime() : NaN;
        if (Number.isFinite(start) && Number.isFinite(end)) items.push({ start, end });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    cache = { from: f, to: t, at: Date.now(), items };
    return items;
  } catch (err) {
    reportError("Google Calendar: чтение занятости", err);
    return [];
  }
}
