-- Две активные записи не могут пересекаться по времени: проверку делает сама БД,
-- атомарно и при любом числе инстансов бота. Интервал [start, end) — записи встык допустимы.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (tstzrange("start", "end") WITH &&) WHERE ("status" = 'active');
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_check" CHECK ("end" > "start");
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK ("status" IN ('active', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_check" CHECK ("service" IN ('makeup', 'hair', 'full'));
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_review_rating_check" CHECK ("review_rating" BETWEEN 1 AND 5);
