import { config } from "../config.js";
import { SERVICES, type ServiceKey } from "../data/services.js";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { dateKeyOf, upcomingDateKeys, zonedToUtc } from "../time.js";
import { getCalendarBusy, type Interval } from "./calendar.js";

/** Шаг сетки начала записи: услуги по 1,5 ч встают одна за другой без «дыр». */
const SLOT_STEP_MIN = 30;
/** Минимальный запас до начала записи. */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;

/** Занятость: активные записи из БД + события из Google Calendar. */
async function getBusy(from: Date, to: Date, excludeId?: number, fresh = false): Promise<Interval[]> {
  const [rows, calendar] = await Promise.all([
    db
      .select({ start: bookings.start, end: bookings.end })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "active"),
          lt(bookings.start, to),
          gt(bookings.end, from),
          excludeId !== undefined ? ne(bookings.id, excludeId) : undefined,
        ),
      ),
    getCalendarBusy(from, to, { fresh }),
  ]);
  return [...rows.map((b) => ({ start: b.start.getTime(), end: b.end.getTime() })), ...calendar];
}

/** Свободные слоты (время начала) по дням — одним запросом к БД и календарю. */
export async function getFreeSlotsByDay(
  dateKeys: string[],
  serviceKey: ServiceKey,
  excludeId?: number,
  { fresh = false } = {},
): Promise<Map<string, Date[]>> {
  const result = new Map<string, Date[]>();
  if (!dateKeys.length) return result;

  const duration = SERVICES[serviceKey].durationMin * 60 * 1000;
  const busy = await getBusy(
    zonedToUtc(dateKeys[0], 0),
    zonedToUtc(dateKeys[dateKeys.length - 1], 24),
    excludeId,
    fresh,
  );

  const earliest = Date.now() + MIN_LEAD_MS;
  for (const dateKey of dateKeys) {
    const dayStart = zonedToUtc(dateKey, config.workStartHour).getTime();
    const dayEnd = zonedToUtc(dateKey, config.workEndHour).getTime();
    const slots: Date[] = [];
    for (let t = dayStart; t + duration <= dayEnd; t += SLOT_STEP_MIN * 60 * 1000) {
      if (t < earliest) continue;
      const end = t + duration;
      if (!busy.some((b) => b.start < end && b.end > t)) slots.push(new Date(t));
    }
    result.set(dateKey, slots);
  }
  return result;
}

/** Свободные слоты (время начала) на дату для выбранной услуги. */
export async function getFreeSlots(dateKey: string, serviceKey: ServiceKey, excludeId?: number): Promise<Date[]> {
  return (await getFreeSlotsByDay([dateKey], serviceKey, excludeId)).get(dateKey) ?? [];
}

/**
 * Можно ли начать услугу в это время: оно должно быть среди свободных слотов
 * (рабочие часы, сетка, запас до начала, окно записи, занятость в БД и календаре).
 * Кнопки со временем могут быть из старого сообщения — поэтому проверяем на сервере.
 * @param fresh — читать календарь без кэша (перед сохранением записи).
 */
export async function isSlotAvailable(
  start: Date,
  serviceKey: ServiceKey,
  excludeId?: number,
  { fresh = false } = {},
): Promise<boolean> {
  const dateKey = dateKeyOf(start);
  if (!upcomingDateKeys(config.bookingDaysAhead).includes(dateKey)) return false;
  const slots = (await getFreeSlotsByDay([dateKey], serviceKey, excludeId, { fresh })).get(dateKey) ?? [];
  return slots.some((s) => s.getTime() === start.getTime());
}

/** Отменить или перенести запись можно не позднее чем за N часов до начала. */
export function canModify(start: Date): boolean {
  return start.getTime() - Date.now() >= config.modifyDeadlineHours * 60 * 60 * 1000;
}
