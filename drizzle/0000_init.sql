CREATE TABLE "bookings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" text,
	"service" text NOT NULL,
	"service_title" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"google_event_id" text,
	"comment" text,
	"photos" text[] DEFAULT '{}'::text[] NOT NULL,
	"reminder24_sent_at" timestamp with time zone,
	"reminder2h_sent_at" timestamp with time zone,
	"client_confirmed_at" timestamp with time zone,
	"master_reminder_sent_at" timestamp with time zone,
	"review_due_at" timestamp with time zone,
	"review_requested_at" timestamp with time zone,
	"review_rating" smallint,
	"review_text" text,
	"review_published" boolean DEFAULT false NOT NULL,
	"review_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bookings_telegram_id_idx" ON "bookings" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "bookings_status_start_idx" ON "bookings" USING btree ("status","start");--> statement-breakpoint
CREATE INDEX "bookings_reviews_idx" ON "bookings" USING btree ("review_created_at") WHERE "bookings"."review_published";