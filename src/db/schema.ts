import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Записи клиентов.
 * Пересечение активных записей по времени запрещено exclusion-constraint'ом `bookings_no_overlap`
 * (см. миграцию drizzle/0001_*.sql) — два клиента не займут одно время даже при одновременном нажатии.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    telegramUsername: text("telegram_username"),
    service: text("service", { enum: ["makeup", "hair", "full"] }).notNull(),
    serviceTitle: text("service_title").notNull(),
    start: tstz("start").notNull(),
    end: tstz("end").notNull(),
    status: text("status", { enum: ["active", "cancelled"] }).notNull().default("active"),
    googleEventId: text("google_event_id"),

    /** Комментарий клиента: событие, пожелания */
    comment: text("comment"),
    /** file_id фото-референсов в Telegram */
    photos: text("photos").array().notNull().default(sql`'{}'::text[]`),

    // Напоминания клиенту (null — ещё не отправлено)
    reminder24SentAt: tstz("reminder24_sent_at"),
    reminder2hSentAt: tstz("reminder2h_sent_at"),
    clientConfirmedAt: tstz("client_confirmed_at"),
    /** Напоминание мастеру за 2 ч */
    masterReminderSentAt: tstz("master_reminder_sent_at"),

    // Отзыв (review_rating = null — отзыва нет)
    reviewDueAt: tstz("review_due_at"),
    reviewRequestedAt: tstz("review_requested_at"),
    reviewRating: smallint("review_rating"),
    reviewText: text("review_text"),
    reviewPublished: boolean("review_published").notNull().default(false),
    reviewCreatedAt: tstz("review_created_at"),

    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("bookings_telegram_id_idx").on(t.telegramId),
    index("bookings_status_start_idx").on(t.status, t.start),
    index("bookings_reviews_idx").on(t.reviewCreatedAt).where(sql`${t.reviewPublished}`),
  ],
);

export type Booking = typeof bookings.$inferSelect;

/** Сессии grammY (шаги записи), чтобы рестарт бота не обрывал начатую запись. */
export const sessions = pgTable("sessions", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});
