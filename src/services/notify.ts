import { GrammyError, InlineKeyboard, type Api } from "grammy";
import { config } from "../config.js";
import { MASTER_TEXTS } from "../data/master.js";
import { TEXTS } from "../data/texts.js";
import { reportError } from "../logger.js";
import type { Booking } from "../db/schema.js";
import { formatDateTime, formatTime } from "../time.js";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const stars = (n: number) => "⭐".repeat(n);

export function bookingLines(b: Booking): string {
  return MASTER_TEXTS.bookingCard({
    service: escapeHtml(b.serviceTitle),
    when: `${formatDateTime(b.start)}–${formatTime(b.end)}`,
    name: escapeHtml(b.name),
    phone: escapeHtml(b.phone),
    telegram: b.telegramUsername
      ? `@${b.telegramUsername}`
      : `<a href="tg://user?id=${b.telegramId}">${MASTER_TEXTS.profileLink}</a>`,
    comment: b.comment ? escapeHtml(b.comment) : undefined,
  });
}

async function sendToMaster(api: Api, text: string, reply_markup?: InlineKeyboard) {
  if (!config.masterChatId) {
    console.warn("MASTER_CHAT_ID не задан — уведомление мастеру не отправлено");
    return;
  }
  await api.sendMessage(config.masterChatId, text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup,
  });
}

/** Кнопка «Открыть запись» — ведёт в карточку записи в панели мастера. */
export const openBookingKeyboard = (b: Booking) =>
  new InlineKeyboard().text(MASTER_TEXTS.openBooking, `m:open:${b.id}`);

export async function notifyMasterNewBooking(api: Api, b: Booking) {
  await sendToMaster(api, MASTER_TEXTS.newBooking(bookingLines(b)), openBookingKeyboard(b));
  if (!config.masterChatId || !b.photos.length) return;
  if (b.photos.length === 1) {
    await api.sendPhoto(config.masterChatId, b.photos[0], { caption: MASTER_TEXTS.photoCaption(b.name) });
  } else {
    await api.sendMediaGroup(
      config.masterChatId,
      b.photos.map((id, i) => ({ type: "photo" as const, media: id, ...(i === 0 && { caption: MASTER_TEXTS.photosCaption(b.name) }) })),
    );
  }
}

export function notifyMasterCancelled(api: Api, b: Booking) {
  return sendToMaster(api, MASTER_TEXTS.cancelled(bookingLines(b)));
}

export function notifyMasterRescheduled(api: Api, b: Booking, oldStart: Date) {
  return sendToMaster(api, MASTER_TEXTS.rescheduled(formatDateTime(oldStart), bookingLines(b)), openBookingKeyboard(b));
}

export function notifyMasterClientConfirmed(api: Api, b: Booking) {
  return sendToMaster(api, MASTER_TEXTS.clientConfirmed(bookingLines(b)), openBookingKeyboard(b));
}

export function notifyMasterReminder(api: Api, b: Booking) {
  return sendToMaster(api, MASTER_TEXTS.reminder2h(bookingLines(b)), openBookingKeyboard(b));
}

// ---------- Уведомления клиенту об изменениях со стороны мастера ----------

async function sendToClient(api: Api, b: Booking, text: string) {
  try {
    await api.sendMessage(b.telegramId, text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(TEXTS.buttons.my, "my"),
    });
  } catch (err) {
    // Клиент заблокировал бота — это не ошибка приложения
    if (err instanceof GrammyError && err.error_code === 403) return;
    reportError("Уведомление клиенту", err);
  }
}

export function notifyClientCancelledByMaster(api: Api, b: Booking) {
  return sendToClient(api, b, TEXTS.byMaster.cancelled(escapeHtml(b.serviceTitle), formatDateTime(b.start)));
}

export function notifyClientRescheduledByMaster(api: Api, b: Booking, oldStart: Date) {
  return sendToClient(
    api,
    b,
    TEXTS.byMaster.rescheduled(escapeHtml(b.serviceTitle), formatDateTime(oldStart), formatDateTime(b.start)),
  );
}

export function reviewModerationKeyboard(b: Booking) {
  return b.reviewPublished
    ? new InlineKeyboard().text(MASTER_TEXTS.review.hideButton, `rvhide:${b.id}`)
    : new InlineKeyboard().text(MASTER_TEXTS.review.publishButton, `rvpub:${b.id}`);
}

export function reviewMasterText(b: Booking, isNew = true) {
  return MASTER_TEXTS.review.card({
    stars: stars(b.reviewRating ?? 0),
    name: escapeHtml(b.name),
    service: escapeHtml(b.serviceTitle),
    when: formatDateTime(b.start),
    text: b.reviewText ? escapeHtml(b.reviewText) : undefined,
    published: b.reviewPublished,
    isNew,
  });
}

export function notifyMasterReview(api: Api, b: Booking) {
  // Публиковать имеет смысл только отзывы с текстом
  return sendToMaster(api, reviewMasterText(b), b.reviewText ? reviewModerationKeyboard(b) : undefined);
}
