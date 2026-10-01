import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

const googleCalendarId = optional("GOOGLE_CALENDAR_ID");
const googleEmail = optional("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const googleKey = optional("GOOGLE_PRIVATE_KEY")?.replace(/\\n/g, "\n");

const webhookUrl = optional("WEBHOOK_URL")?.replace(/\/$/, "");
// Без секрета любой может прислать на /telegram поддельный апдейт (в т.ч. от имени мастера)
const webhookSecret = webhookUrl ? required("WEBHOOK_SECRET") : optional("WEBHOOK_SECRET");

// Mini App с календарём открывается только по https — по умолчанию с того же адреса, что и webhook
const webAppUrl = (optional("WEBAPP_URL") ?? (webhookUrl && `${webhookUrl}/app/`))?.replace(/\/?$/, "/");

export const config = {
  botToken: required("BOT_TOKEN"),
  masterChatId: optional("MASTER_CHAT_ID"),
  /** Куда слать алерты об ошибках (разработчику). */
  adminChatId: optional("ADMIN_CHAT_ID"),
  databaseUrl: required("DATABASE_URL"),
  google:
    googleCalendarId && googleEmail && googleKey
      ? { calendarId: googleCalendarId, email: googleEmail, privateKey: googleKey }
      : undefined,
  timezone: process.env.TIMEZONE || "Europe/Moscow",
  workStartHour: Number(process.env.WORK_START_HOUR || 9),
  workEndHour: Number(process.env.WORK_END_HOUR || 18),
  bookingDaysAhead: Number(process.env.BOOKING_DAYS_AHEAD || 60),
  modifyDeadlineHours: Number(process.env.MODIFY_DEADLINE_HOURS || 2),
  /** Во сколько (по местному времени) на следующий день после записи просить отзыв. */
  reviewHour: Number(process.env.REVIEW_HOUR || 12),

  /** Публичный https-адрес бота; если задан — режим webhook, иначе long polling. */
  webhookUrl,
  webhookSecret,
  /** Адрес Mini App с календарём; не задан — выбор даты только кнопками. */
  webAppUrl,
  port: Number(process.env.PORT || 3000),
};
