import {InlineKeyboard, type Bot} from "grammy";
import {and, asc, desc, eq, gt, gte, isNotNull, lt} from "drizzle-orm";
import type {Ctx} from "./bot.js";
import {config} from "./config.js";
import {MASTER_TEXTS} from "./data/master.js";
import {db} from "./db/index.js";
import {bookings, type Booking} from "./db/schema.js";
import {cancelBooking, rescheduleBooking} from "./services/bookings.js";
import {bookingLines, escapeHtml, reviewMasterText, stars} from "./services/notify.js";
import {addDays, dateKeyOf, formatDateKey, formatDateTime, formatTime, zonedToUtc} from "./time.js";

const T = MASTER_TEXTS.panel;
const PB = T.buttons;
const PAGE_SIZE = 8;

export const isMaster = (ctx: Ctx) => Boolean(config.masterChatId) && String(ctx.from?.id) === config.masterChatId;

function panelKeyboard() {
    return new InlineKeyboard()
        .text(PB.today, "m:today").text(PB.tomorrow, "m:tomorrow").row()
        .text(PB.upcoming, "m:up:0").row()
        .text(PB.reviews, "m:rv:0");
}

export async function showMasterPanel(ctx: Ctx, edit = false) {
    ctx.session = {step: "idle"};
    const opts = {parse_mode: "HTML" as const, reply_markup: panelKeyboard()};
    if (edit) await ctx.editMessageText(T.title, opts);
    else await ctx.reply(T.title, opts);
}

/** Все отзывы (и опубликованные, и нет) — новые сверху, постранично. */
export async function showMasterReviews(ctx: Ctx, page = 0, edit = false) {
    const list = await db
        .select()
        .from(bookings)
        .where(isNotNull(bookings.reviewRating))
        .orderBy(desc(bookings.reviewCreatedAt))
        .offset(page * PAGE_SIZE)
        .limit(PAGE_SIZE + 1);
    const hasMore = list.length > PAGE_SIZE;
    const shown = list.slice(0, PAGE_SIZE);

    const lines = shown.map((b) =>
        T.reviewLine({
            stars: stars(b.reviewRating ?? 0),
            name: escapeHtml(b.name),
            when: formatDateTime(b.start),
            published: b.reviewPublished,
        }),
    );
    const kb = new InlineKeyboard();
    for (const b of shown) kb.text(PB.review(stars(b.reviewRating ?? 0), b.name), `m:rvb:${b.id}`).row();
    if (page > 0) kb.text(PB.prevPage, `m:rv:${page - 1}`);
    if (hasMore) kb.text(PB.nextPage, `m:rv:${page + 1}`);
    kb.row().text(PB.panel, "m:panel");

    const text = T.reviews(lines) + (shown.length ? T.reviewsLegend : "");
    const opts = {parse_mode: "HTML" as const, reply_markup: kb};
    if (edit) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
}

/** Карточка отзыва в панели: публикация/скрытие (только с текстом — как в уведомлении) и возврат к списку. */
function reviewCardView(b: Booking) {
    const kb = new InlineKeyboard();
    if (b.reviewText) {
        kb.text(b.reviewPublished ? MASTER_TEXTS.review.hideButton : MASTER_TEXTS.review.publishButton, `m:rvt:${b.id}`).row();
    }
    kb.text(PB.toReviews, "m:rv:0");
    return {text: reviewMasterText(b, false), kb};
}

/** Карточка записи для мастера: данные, статус и доступные действия. */
function cardView(b: Booking) {
    const upcoming = b.status === "active" && b.start.getTime() > Date.now();
    const status =
        b.status === "cancelled" ? T.status.cancelled
            : !upcoming ? T.status.past
                : b.clientConfirmedAt ? T.status.confirmed
                    : T.status.active;

    const kb = new InlineKeyboard();
    if (upcoming) kb.text(PB.reschedule, `m:rs:${b.id}`).text(PB.cancel, `m:cx:${b.id}`).row();
    if (b.photos.length) kb.text(PB.photos(b.photos.length), `m:ph:${b.id}`).row();
    kb.text(PB.toDay, `m:day:${dateKeyOf(b.start)}`).text(PB.panel, "m:panel");
    return {text: T.card(bookingLines(b), status), kb};
}

async function findById(id: number): Promise<Booking | undefined> {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    return b;
}

/** Активная предстоящая запись. */
async function findUpcoming(id: number): Promise<Booking | undefined> {
    const [b] = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, id), eq(bookings.status, "active"), gt(bookings.start, new Date())));
    return b;
}

/** Экран после переноса записи мастером (вызывается из общего потока переноса в bot.ts). */
export async function confirmMasterReschedule(ctx: Ctx, id: number, start: number) {
    if (!isMaster(ctx)) return ctx.answerCallbackQuery(T.forbidden);
    const booking = await findUpcoming(id);
    if (!booking) {
        await ctx.answerCallbackQuery({text: T.notActive, show_alert: true});
        return showMasterPanel(ctx, true);
    }
    await ctx.answerCallbackQuery();

    const result = await rescheduleBooking(ctx.api, booking, new Date(start), "master");
    if (!result.ok) {
        const {text, kb} = cardView(booking);
        return ctx.editMessageText(`${T.slotTaken}\n\n${text}`, {parse_mode: "HTML", reply_markup: kb});
    }
    const {kb} = cardView(result.booking);
    await ctx.editMessageText(T.rescheduled(bookingLines(result.booking)), {
        parse_mode: "HTML",
        reply_markup: kb,
        link_preview_options: {is_disabled: true},
    });
}

export function registerMaster(bot: Bot<Ctx>, deps: { showMonths: (ctx: Ctx) => Promise<unknown> }) {
    bot.command("master", async (ctx) => {
        if (!isMaster(ctx)) return;
        await showMasterPanel(ctx);
    });

    // Все кнопки панели (m:...) — только мастеру
    bot.callbackQuery(/^m:/, async (ctx, next) => {
        if (!isMaster(ctx)) return ctx.answerCallbackQuery(T.forbidden);
        await next();
    });

    bot.callbackQuery("m:panel", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showMasterPanel(ctx, true);
    });

    // ---------- Отзывы ----------
    bot.callbackQuery(/^m:rv:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showMasterReviews(ctx, Number(ctx.match[1]), true);
    });

    bot.callbackQuery(/^m:rvb:(\d{1,9})$/, async (ctx) => {
        const booking = await findById(Number(ctx.match[1]));
        if (booking?.reviewRating == null) return ctx.answerCallbackQuery(MASTER_TEXTS.review.notFound);
        await ctx.answerCallbackQuery();
        const {text, kb} = reviewCardView(booking);
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    });

    bot.callbackQuery(/^m:rvt:(\d{1,9})$/, async (ctx) => {
        const current = await findById(Number(ctx.match[1]));
        if (!current?.reviewText) return ctx.answerCallbackQuery(MASTER_TEXTS.review.notFound);
        const [booking] = await db
            .update(bookings)
            .set({reviewPublished: !current.reviewPublished})
            .where(eq(bookings.id, current.id))
            .returning();
        await ctx.answerCallbackQuery(
            booking.reviewPublished ? MASTER_TEXTS.review.publishedToast : MASTER_TEXTS.review.hiddenToast,
        );
        const {text, kb} = reviewCardView(booking);
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    });

    // ---------- День ----------
    async function showDay(ctx: Ctx, dateKey: string) {
        const list = await db
            .select()
            .from(bookings)
            .where(
                and(
                    eq(bookings.status, "active"),
                    gte(bookings.start, zonedToUtc(dateKey, 0)),
                    lt(bookings.start, zonedToUtc(addDays(dateKey, 1), 0)),
                ),
            )
            .orderBy(asc(bookings.start));

        const lines = list.map((b) =>
            T.dayLine({
                from: formatTime(b.start),
                to: formatTime(b.end),
                service: escapeHtml(b.serviceTitle),
                name: escapeHtml(b.name),
                confirmed: Boolean(b.clientConfirmedAt),
            }),
        );
        const kb = new InlineKeyboard();
        for (const b of list) kb.text(PB.booking(formatTime(b.start), b.name), `m:b:${b.id}`).row();
        kb.text(PB.prevDay, `m:day:${addDays(dateKey, -1)}`).text(PB.nextDay, `m:day:${addDays(dateKey, 1)}`).row();
        kb.text(PB.panel, "m:panel");

        const text = T.day(formatDateKey(dateKey), lines) + (list.length ? T.legend : "");
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    }

    bot.callbackQuery("m:today", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showDay(ctx, dateKeyOf(new Date()));
    });

    bot.callbackQuery("m:tomorrow", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showDay(ctx, addDays(dateKeyOf(new Date()), 1));
    });

    bot.callbackQuery(/^m:day:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showDay(ctx, ctx.match[1]);
    });

    // ---------- Все предстоящие ----------
    bot.callbackQuery(/^m:up:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const page = Number(ctx.match[1]);
        const list = await db
            .select()
            .from(bookings)
            .where(and(eq(bookings.status, "active"), gt(bookings.start, new Date())))
            .orderBy(asc(bookings.start))
            .offset(page * PAGE_SIZE)
            .limit(PAGE_SIZE + 1);
        const hasMore = list.length > PAGE_SIZE;
        const shown = list.slice(0, PAGE_SIZE);

        const lines = shown.map((b) =>
            T.upcomingLine({
                when: formatDateTime(b.start),
                service: escapeHtml(b.serviceTitle),
                name: escapeHtml(b.name),
                confirmed: Boolean(b.clientConfirmedAt),
            }),
        );
        const kb = new InlineKeyboard();
        for (const b of shown) kb.text(PB.bookingWithDate(formatDateTime(b.start), b.name), `m:b:${b.id}`).row();
        if (page > 0) kb.text(PB.prevPage, `m:up:${page - 1}`);
        if (hasMore) kb.text(PB.nextPage, `m:up:${page + 1}`);
        kb.row().text(PB.panel, "m:panel");

        const text = T.upcoming(lines) + (shown.length ? T.legend : "");
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    });

    // ---------- Карточка записи ----------
    /**
     * m:b — карточка внутри панели (редактируем сообщение);
     * m:open — из уведомления (новое сообщение, чтобы уведомление осталось в истории).
     */
    bot.callbackQuery(/^m:(b|open):(\d{1,9})$/, async (ctx) => {
        const booking = await findById(Number(ctx.match[2]));
        if (!booking) return ctx.answerCallbackQuery(T.notFound);
        await ctx.answerCallbackQuery();
        const {text, kb} = cardView(booking);
        const opts = {parse_mode: "HTML" as const, reply_markup: kb, link_preview_options: {is_disabled: true}};
        if (ctx.match[1] === "open") await ctx.reply(text, opts);
        else await ctx.editMessageText(text, opts);
    });

    bot.callbackQuery(/^m:ph:(\d{1,9})$/, async (ctx) => {
        const booking = await findById(Number(ctx.match[1]));
        if (!booking?.photos.length) return ctx.answerCallbackQuery(T.notFound);
        await ctx.answerCallbackQuery();
        const caption = MASTER_TEXTS.photosCaption(booking.name);
        if (booking.photos.length === 1) await ctx.replyWithPhoto(booking.photos[0], {caption});
        else {
            await ctx.replyWithMediaGroup(
                booking.photos.map((id, i) => ({type: "photo" as const, media: id, ...(i === 0 && {caption})})),
            );
        }
    });

    // ---------- Отмена ----------
    async function findActive(ctx: Ctx, id: number) {
        const booking = await findUpcoming(id);
        if (!booking) await ctx.answerCallbackQuery({text: T.notActive, show_alert: true});
        return booking;
    }

    bot.callbackQuery(/^m:cx:(\d{1,9})$/, async (ctx) => {
        const booking = await findActive(ctx, Number(ctx.match[1]));
        if (!booking) return;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(T.cancelAsk(bookingLines(booking)), {
            parse_mode: "HTML",
            link_preview_options: {is_disabled: true},
            reply_markup: new InlineKeyboard()
                .text(PB.cancelYes, `m:cxy:${booking.id}`)
                .text(PB.cancelNo, `m:b:${booking.id}`),
        });
    });

    bot.callbackQuery(/^m:cxy:(\d{1,9})$/, async (ctx) => {
        const found = await findActive(ctx, Number(ctx.match[1]));
        if (!found) return;
        const booking = await cancelBooking(ctx.api, found.id, "master");
        if (!booking) return ctx.answerCallbackQuery({text: T.notActive, show_alert: true});
        await ctx.answerCallbackQuery(T.cancelledToast);
        const {text, kb} = cardView(booking);
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb, link_preview_options: {is_disabled: true}});
    });

    // ---------- Перенос: дальше общий поток выбора месяца/дня/времени из bot.ts ----------
    bot.callbackQuery(/^m:rs:(\d{1,9})$/, async (ctx) => {
        const booking = await findActive(ctx, Number(ctx.match[1]));
        if (!booking) return;
        await ctx.answerCallbackQuery();
        ctx.session = {
            step: "idle",
            service: booking.service,
            rescheduleId: booking.id,
            byMaster: true,
        };
        await deps.showMonths(ctx);
    });
}
