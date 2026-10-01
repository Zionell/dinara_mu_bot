import { and, eq } from "drizzle-orm";
import type { Api } from "grammy";
import { config } from "../config.js";
import { SERVICES, type ServiceKey } from "../data/services.js";
import { db, isOverlapError } from "../db/index.js";
import { bookings, type Booking } from "../db/schema.js";
import { logNotifyError, reportError } from "../logger.js";
import { addDays, dateKeyOf, zonedToUtc } from "../time.js";
import { createCalendarEvent, deleteCalendarEvent, moveCalendarEvent } from "./calendar.js";
import {
  notifyClientCancelledByMaster,
  notifyClientRescheduledByMaster,
  notifyMasterCancelled,
  notifyMasterNewBooking,
  notifyMasterRescheduled,
} from "./notify.js";
import { isSlotAvailable } from "./slots.js";

export type BookingResult = { ok: true; booking: Booking } | { ok: false; reason: "taken" };
/** Кто меняет запись: клиенту сообщаем об изменениях мастера и наоборот. */
export type ChangedBy = "client" | "master";

const HOUR = 60 * 60 * 1000;

/** Поля расписания напоминаний/отзыва для записи на указанное время. */
function scheduleFields(start: Date, end: Date) {
  const now = Date.now();
  const until = start.getTime() - now;
  return {
    // Если до записи уже меньше суток / 3 часов — соответствующее напоминание не нужно
    reminder24SentAt: until < 24 * HOUR ? new Date() : null,
    reminder2hSentAt: until < 3 * HOUR ? new Date() : null,
    // Мастеру при записи «впритык» и так пришло уведомление о новой записи / переносе
    masterReminderSentAt: until < 2.5 * HOUR ? new Date() : null,
    clientConfirmedAt: null,
    reviewDueAt: zonedToUtc(addDays(dateKeyOf(end), 1), config.reviewHour),
    reviewRequestedAt: null,
  };
}

export interface NewBooking {
  name: string;
  phone: string;
  telegramId: number;
  telegramUsername?: string;
  service: ServiceKey;
  start: Date;
  comment?: string;
  photos?: string[];
}

export async function createBooking(api: Api, input: NewBooking): Promise<BookingResult> {
  const s = SERVICES[input.service];
  const start = input.start;
  const end = new Date(start.getTime() + s.durationMin * 60 * 1000);

  // Сетка, рабочие часы, занятость в Google Calendar; гонку с другими записями дополнительно отсечёт БД
  if (!(await isSlotAvailable(start, input.service, undefined, { fresh: true }))) return { ok: false, reason: "taken" };

  let booking: Booking;
  try {
    [booking] = await db
      .insert(bookings)
      .values({ ...input, serviceTitle: s.title, end, ...scheduleFields(start, end) })
      .returning();
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, reason: "taken" };
    throw err;
  }

  try {
    const eventId = await createCalendarEvent(booking);
    if (eventId) {
      await db.update(bookings).set({ googleEventId: eventId }).where(eq(bookings.id, booking.id));
      booking.googleEventId = eventId;
    }
  } catch (err) {
    reportError("Google Calendar: создание события", err);
  }
  await notifyMasterNewBooking(api, booking).catch(logNotifyError);

  return { ok: true, booking };
}

/** Отменить активную запись. Возвращает отменённую запись или undefined, если она уже не активна. */
export async function cancelBooking(api: Api, id: number, by: ChangedBy = "client"): Promise<Booking | undefined> {
  const [booking] = await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, id), eq(bookings.status, "active")))
    .returning();
  if (!booking) return undefined;

  if (booking.googleEventId) {
    await deleteCalendarEvent(booking.googleEventId).catch((err) =>
      reportError("Google Calendar: удаление события", err),
    );
  }
  if (by === "master") await notifyClientCancelledByMaster(api, booking);
  else await notifyMasterCancelled(api, booking).catch(logNotifyError);
  return booking;
}

export async function rescheduleBooking(
  api: Api,
  booking: Booking,
  newStart: Date,
  by: ChangedBy = "client",
): Promise<BookingResult> {
  const newEnd = new Date(newStart.getTime() + SERVICES[booking.service].durationMin * 60 * 1000);

  if (!(await isSlotAvailable(newStart, booking.service, booking.id, { fresh: true }))) {
    return { ok: false, reason: "taken" };
  }

  let updated: Booking | undefined;
  try {
    [updated] = await db
      .update(bookings)
      .set({ start: newStart, end: newEnd, ...scheduleFields(newStart, newEnd) })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "active")))
      .returning();
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, reason: "taken" };
    throw err;
  }
  if (!updated) return { ok: false, reason: "taken" };

  if (updated.googleEventId) {
    await moveCalendarEvent(updated.googleEventId, newStart, newEnd).catch((err) =>
      reportError("Google Calendar: перенос события", err),
    );
  }
  if (by === "master") await notifyClientRescheduledByMaster(api, updated, booking.start);
  else await notifyMasterRescheduled(api, updated, booking.start).catch(logNotifyError);

  return { ok: true, booking: updated };
}
