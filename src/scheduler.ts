import { GrammyError, InlineKeyboard, type Api } from "grammy";
import { config } from "./config.js";
import { reportError } from "./logger.js";
import { hasLocation } from "./data/location.js";
import { TEXTS } from "./data/texts.js";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "./db/index.js";
import { bookings, type Booking } from "./db/schema.js";
import { notifyMasterReminder } from "./services/notify.js";
import { formatDateTime } from "./time.js";

const TICK_MS = 60_000;
const HOUR = 60 * 60 * 1000;
/** Не просим отзыв, если «окно» пропущено больше чем на 3 дня (например, бот был выключен). */
const REVIEW_MAX_DELAY_MS = 3 * 24 * HOUR;

type ReminderField = "reminder24SentAt" | "reminder2hSentAt" | "masterReminderSentAt" | "reviewRequestedAt";

/** Атомарно «забрать» задачу, чтобы при нескольких инстансах сообщение ушло один раз. */
async function claim(id: number, field: ReminderField): Promise<boolean> {
  const claimed = await db
    .update(bookings)
    .set({ [field]: new Date() })
    .where(and(eq(bookings.id, id), isNull(bookings[field])))
    .returning({ id: bookings.id });
  return claimed.length === 1;
}

/** Активные записи, у которых ещё не отправлено `field` и начало попадает в (now, now + aheadMs]. */
function dueBefore(field: ReminderField, aheadMs: number) {
  const now = Date.now();
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "active"),
        isNull(bookings[field]),
        gt(bookings.start, new Date(now)),
        lte(bookings.start, new Date(now + aheadMs)),
      ),
    );
}

async function safeSend(where: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    // Клиент заблокировал бота — это не ошибка приложения
    if (err instanceof GrammyError && err.error_code === 403) return;
    reportError(where, err);
  }
}

function reminderKeyboard(b: Booking, withActions: boolean) {
  const kb = new InlineKeyboard();
  if (withActions) {
    kb.text(TEXTS.buttons.iConfirm, `rconfirm:${b.id}`).row();
    kb.text(TEXTS.buttons.move, `resched:${b.id}`).text(TEXTS.buttons.cancel, `cancelask:${b.id}`).row();
  }
  if (hasLocation()) kb.text(TEXTS.buttons.location, "location");
  return kb;
}

async function sendReminders(api: Api, field: "reminder24SentAt" | "reminder2hSentAt", aheadMs: number) {
  const due = await dueBefore(field, aheadMs);

  for (const b of due) {
    if (!(await claim(b.id, field))) continue;
    const is24 = field === "reminder24SentAt";
    const text = (is24 ? TEXTS.reminders.dayBefore : TEXTS.reminders.twoHours)(b.serviceTitle, formatDateTime(b.start));
    await safeSend("Напоминание клиенту", () =>
      api.sendMessage(b.telegramId, text, { reply_markup: reminderKeyboard(b, is24) }),
    );
  }
}

/** Напоминание мастеру за 2 часа до записи. */
async function sendMasterReminders(api: Api) {
  if (!config.masterChatId) return;
  const due = await dueBefore("masterReminderSentAt", 2 * HOUR);

  for (const b of due) {
    if (!(await claim(b.id, "masterReminderSentAt"))) continue;
    await safeSend("Напоминание мастеру", () => notifyMasterReminder(api, b));
  }
}

async function sendReviewRequests(api: Api) {
  const now = Date.now();
  const due = await db
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.status, "active"), isNull(bookings.reviewRequestedAt), lte(bookings.reviewDueAt, new Date(now))),
    );

  for (const b of due) {
    if (!(await claim(b.id, "reviewRequestedAt"))) continue;
    if (now - b.reviewDueAt!.getTime() > REVIEW_MAX_DELAY_MS) continue;

    const kb = new InlineKeyboard();
    for (let n = 1; n <= 5; n++) kb.text(TEXTS.buttons.rate(n), `rate:${b.id}:${n}`);
    await safeSend("Запрос отзыва", () =>
      api.sendMessage(b.telegramId, TEXTS.reviews.request(b.name, b.serviceTitle), { reply_markup: kb }),
    );
  }
}

export function startScheduler(api: Api): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendReminders(api, "reminder24SentAt", 24 * HOUR);
      await sendReminders(api, "reminder2hSentAt", 2 * HOUR);
      await sendMasterReminders(api);
      await sendReviewRequests(api);
    } catch (err) {
      reportError("Планировщик", err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}
