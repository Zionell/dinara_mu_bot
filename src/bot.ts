import {sequentialize} from "@grammyjs/runner";
import {Bot, GrammyError, InlineKeyboard, Keyboard, session, type Api, type Context, type SessionFlavor} from "grammy";
import {and, asc, desc, eq, gt, isNotNull, isNull} from "drizzle-orm";
import {config} from "./config.js";
import {SERVICES, type ServiceKey} from "./data/services.js";
import {LOCATION, hasLocation} from "./data/location.js";
import {TEXTS} from "./data/texts.js";
import {MASTER_TEXTS} from "./data/master.js";
import {logNotifyError, reportError} from "./logger.js";
import {confirmMasterReschedule, isMaster, registerMaster, showMasterPanel, showMasterReviews} from "./master.js";
import {db} from "./db/index.js";
import {pgSessionStorage} from "./db/sessionStorage.js";
import {webAppUrl} from "./webapp.js";
import {bookings, type Booking} from "./db/schema.js";
import {cancelBooking, createBooking, rescheduleBooking} from "./services/bookings.js";
import {canModify, getFreeSlots, getFreeSlotsByDay, isSlotAvailable} from "./services/slots.js";
import {
    escapeHtml,
    notifyMasterClientConfirmed,
    notifyMasterReview,
    reviewMasterText,
    reviewModerationKeyboard,
    stars,
} from "./services/notify.js";
import {
    formatDateKey,
    formatDateTime,
    formatMonthKey,
    formatShortDateTime,
    formatTime,
    monthDateKeys,
    upcomingDateKeys,
    weekdayMon,
} from "./time.js";

export interface SessionData {
    step: "idle" | "name" | "phone" | "comment" | "confirm" | "review";
    service?: ServiceKey;
    date?: string;
    start?: number;
    name?: string;
    phone?: string;
    comment?: string;
    photos?: string[];
    /** media_group_id альбома, который клиент прислал на шаге комментария */
    mediaGroup?: string;
    /** id записи, которую клиент переносит */
    rescheduleId?: number;
    /** id записи, на которую клиент пишет отзыв */
    reviewBookingId?: number;
    /** Перенос делает мастер из своей панели */
    byMaster?: boolean;
    /** Сообщение с кнопкой календаря (Mini App) — его правим, когда время выбрано в Mini App */
    calendarMsgId?: number;
}

export type Ctx = Context & SessionFlavor<SessionData>;

const MAX_PHOTOS = 5;

const isEmptySession = (s: SessionData) => Object.keys(s).length === 1 && s.step === "idle";
/** Общее хранилище сессий: им пользуется и бот, и API календаря (src/webapp.ts). Ключ — id чата. */
export const sessionStore = pgSessionStorage<SessionData>(isEmptySession);

const B = TEXTS.buttons;

function mainMenu() {
    const kb = new InlineKeyboard().text(B.book, "book").row().text(B.my, "my").row();
    if (hasLocation()) kb.text(B.location, "location").row();
    kb.text(B.reviews, "reviews");
    return kb;
}

function normalizePhone(raw: string): string | undefined {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return `+7${digits.slice(1)}`;
    if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`;
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return undefined;
}

/** Заголовок шагов выбора даты/времени: услуга (и пометка о переносе). */
export function bookingHeader(session: SessionData): string {
    const title = `<b>${SERVICES[session.service!].title}</b>`;
    return session.rescheduleId ? TEXTS.booking.rescheduleHeader(title) : title;
}

/**
 * Время выбрано (кнопкой или в Mini App): запоминаем его в сессии и переходим дальше —
 * к подтверждению переноса или к вводу имени. `messageId` — сообщение, которое заменяем.
 */
export async function continueWithTime(
    api: Api,
    chatId: number,
    session: SessionData,
    start: number,
    {messageId, otherTime}: {messageId?: number; otherTime: string},
) {
    session.start = start;
    const show = async (text: string, reply_markup?: InlineKeyboard) => {
        if (messageId) {
            try {
                return await api.editMessageText(chatId, messageId, text, {parse_mode: "HTML", reply_markup});
            } catch {
                // Сообщение старое или удалено — пришлём новое
            }
        }
        return api.sendMessage(chatId, text, {parse_mode: "HTML", reply_markup});
    };

    if (session.rescheduleId) {
        await show(
            TEXTS.booking.rescheduleConfirm(formatDateTime(new Date(start))),
            new InlineKeyboard().text(B.reschedule, "resched_ok").text(B.otherTime, otherTime),
        );
        return;
    }

    session.step = "name";
    await show(TEXTS.booking.selected(SERVICES[session.service!].title, formatDateTime(new Date(start))));
    await api.sendMessage(chatId, TEXTS.booking.askName);
}

export function createBot() {
    const bot = new Bot<Ctx>(config.botToken);

    // Апдейты одного чата — строго по очереди (в webhook-режиме они приходят параллельно):
    // иначе сессия перезаписывается гонкой — теряются фото альбома, двойное нажатие срабатывает дважды
    bot.use(sequentialize((ctx: Ctx) => ctx.chat?.id.toString() ?? ctx.from?.id.toString()));
    bot.use(
        session({
            initial: (): SessionData => ({step: "idle"}),
            storage: sessionStore,
        }),
    );

    const reset = (ctx: Ctx) => {
        ctx.session = {step: "idle"};
    };

    // ---------- Меню ----------
    bot.command("start", async (ctx) => {
        if (isMaster(ctx)) return showMasterPanel(ctx);
        reset(ctx);
        await ctx.reply(TEXTS.welcome, {parse_mode: "HTML", reply_markup: mainMenu()});
    });

    bot.command("cancel", async (ctx) => {
        reset(ctx);
        await ctx.reply(TEXTS.menu.flowCancelled, {reply_markup: {remove_keyboard: true}});
        await ctx.reply(TEXTS.menu.whatNext, {reply_markup: mainMenu()});
    });

    // Записаться / мои записи / как добраться — только для клиента; мастеру — его панель
    bot.command("book", (ctx) => (isMaster(ctx) ? showMasterPanel(ctx) : showServices(ctx)));
    bot.command("my", (ctx) => (isMaster(ctx) ? showMasterPanel(ctx) : showMyBookings(ctx)));
    bot.command("location", (ctx) => (isMaster(ctx) ? showMasterPanel(ctx) : sendLocation(ctx)));
    bot.command("reviews", (ctx) => (isMaster(ctx) ? showMasterReviews(ctx) : showReviews(ctx)));
    // Узнать свой Telegram ID (для MASTER_CHAT_ID / ADMIN_CHAT_ID)
    bot.command("myid", (ctx) => ctx.reply(TEXTS.myId(ctx.from?.id ?? ""), {parse_mode: "HTML"}));

    bot.callbackQuery("menu", async (ctx) => {
        reset(ctx);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(TEXTS.welcome, {parse_mode: "HTML", reply_markup: mainMenu()});
    });

    // ---------- Как добраться ----------
    async function sendLocation(ctx: Ctx) {
        if (!hasLocation()) return ctx.reply(TEXTS.location.fallback);
        if (LOCATION.latitude !== undefined && LOCATION.longitude !== undefined) {
            await ctx.replyWithVenue(LOCATION.latitude, LOCATION.longitude, LOCATION.title, LOCATION.address);
        }
        const text = [LOCATION.address && TEXTS.location.address(escapeHtml(LOCATION.address)), LOCATION.directions]
            .filter(Boolean)
            .join("\n\n");
        if (text) await ctx.reply(text, {parse_mode: "HTML", link_preview_options: {is_disabled: true}});
    }

    bot.callbackQuery("location", async (ctx) => {
        await ctx.answerCallbackQuery();
        await sendLocation(ctx);
    });

    // ---------- Шаг 1: услуга ----------
    async function showServices(ctx: Ctx, edit = false) {
        reset(ctx);
        const kb = new InlineKeyboard();
        for (const s of Object.values(SERVICES)) kb.text(s.title, `svc:${s.key}`).row();
        kb.text(B.back, "menu");
        const text = TEXTS.booking.chooseService;
        if (edit) await ctx.editMessageText(text, {reply_markup: kb});
        else await ctx.reply(text, {reply_markup: kb});
    }

    bot.callbackQuery("book", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showServices(ctx, true);
    });

    // ---------- Шаг 2: месяц ----------
    /** Даты, открытые для записи, со свободными слотами — сгруппированные по месяцам. */
    async function availableDays(ctx: Ctx): Promise<Map<string, Map<string, Date[]>>> {
        const keys = upcomingDateKeys(config.bookingDaysAhead);
        const slots = await getFreeSlotsByDay(keys, ctx.session.service!, ctx.session.rescheduleId);
        const byMonth = new Map<string, Map<string, Date[]>>();
        for (const [dateKey, daySlots] of slots) {
            if (!daySlots.length) continue;
            const monthKey = dateKey.slice(0, 7);
            if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map());
            byMonth.get(monthKey)!.set(dateKey, daySlots);
        }
        return byMonth;
    }

    const header = (ctx: Ctx) => bookingHeader(ctx.session);

    async function showMonths(ctx: Ctx) {
        const byMonth = await availableDays(ctx);
        const kb = new InlineKeyboard();
        // Mini App с календарём (нужен https) — основной способ; месяцы ниже остаются запасным
        const appUrl = byMonth.size ? webAppUrl(ctx.session) : undefined;
        if (appUrl) {
            kb.webApp(B.openCalendar, appUrl).row();
            ctx.session.calendarMsgId = ctx.callbackQuery?.message?.message_id;
        }
        [...byMonth.keys()].forEach((monthKey, i) => {
            kb.text(formatMonthKey(monthKey), `month:${monthKey}`);
            if (i % 2 === 1) kb.row();
        });
        const {byMaster, rescheduleId} = ctx.session;
        const back = byMaster ? `m:b:${rescheduleId}` : rescheduleId ? `mybk:${rescheduleId}` : "book";
        kb.row().text(B.back, back);

        const text = byMonth.size
            ? TEXTS.booking.chooseMonth(header(ctx))
            : TEXTS.booking.noSlots;
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    }

    bot.callbackQuery(/^svc:(\w+)$/, async (ctx) => {
        const key = ctx.match[1] as ServiceKey;
        if (!SERVICES[key]) return ctx.answerCallbackQuery(TEXTS.booking.unknownService);
        await ctx.answerCallbackQuery();
        ctx.session = {step: "idle", service: key};
        await showMonths(ctx);
    });

    bot.callbackQuery("months", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.session.service) return showServices(ctx, true);
        await showMonths(ctx);
    });

    // Пустые клетки календаря
    bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

    // Недоступные дни: кнопка видна, но только показывает причину
    bot.callbackQuery(/^off:(past|closed|busy)$/, (ctx) =>
        ctx.answerCallbackQuery(TEXTS.calendar.off[ctx.match[1] as keyof typeof TEXTS.calendar.off]),
    );

    /** Зачёркнутое число — «задизейбленный» день. */
    const strike = (text: string) => [...text].map((ch) => ch + "̶").join("");

    // ---------- Шаг 3: день (сетка календаря) ----------
    bot.callbackQuery(/^month:(\d{4}-\d{2})$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.session.service) return showServices(ctx, true);

        const monthKey = ctx.match[1];
        const byMonth = await availableDays(ctx);
        const freeDays = byMonth.get(monthKey);
        if (!freeDays) return showMonths(ctx);

        const kb = new InlineKeyboard();
        for (const w of TEXTS.calendar.weekdays) kb.text(w, "noop");
        kb.row();

        const days = monthDateKeys(monthKey);
        const open = upcomingDateKeys(config.bookingDaysAhead);
        const [firstOpen, lastOpen] = [open[0], open[open.length - 1]];
        const cells: { label: string; data: string }[] = [];
        for (let i = 0; i < weekdayMon(days[0]); i++) cells.push({label: " ", data: "noop"});
        for (const dateKey of days) {
            const day = String(Number(dateKey.slice(8)));
            if (freeDays.has(dateKey)) {
                cells.push({label: day, data: `date:${dateKey}`});
            } else {
                const reason = dateKey < firstOpen ? "past" : dateKey > lastOpen ? "closed" : "busy";
                cells.push({label: strike(day), data: `off:${reason}`});
            }
        }
        while (cells.length % 7) cells.push({label: " ", data: "noop"});
        cells.forEach((c, i) => {
            kb.text(c.label, c.data);
            if (i % 7 === 6) kb.row();
        });

        // Навигация между месяцами, в которых есть свободные дни
        const months = [...byMonth.keys()];
        const idx = months.indexOf(monthKey);
        if (idx > 0) kb.text(B.prevMonth(formatMonthKey(months[idx - 1])), `month:${months[idx - 1]}`);
        if (idx < months.length - 1) kb.text(B.nextMonth(formatMonthKey(months[idx + 1])), `month:${months[idx + 1]}`);
        kb.row().text(B.toMonths, "months");

        await ctx.editMessageText(TEXTS.booking.chooseDay(header(ctx), formatMonthKey(monthKey)), {
            parse_mode: "HTML",
            reply_markup: kb,
        });
    });

    // ---------- Шаг 4: время ----------
    bot.callbackQuery(/^date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const service = ctx.session.service;
        if (!service) return showServices(ctx, true);

        const date = ctx.match[1];
        ctx.session.date = date;
        const slots = await getFreeSlots(date, service, ctx.session.rescheduleId);

        const kb = new InlineKeyboard();
        slots.forEach((s, i) => {
            kb.text(formatTime(s), `time:${s.getTime()}`);
            if (i % 4 === 3) kb.row();
        });
        kb.row().text(B.toCalendar, `month:${date.slice(0, 7)}`);

        const text = slots.length
            ? TEXTS.booking.chooseTime(header(ctx), formatDateKey(date))
            : TEXTS.booking.noTimeOnDate;
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    });

    // ---------- Шаг 5: имя ----------
    bot.callbackQuery(/^time:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const {service, rescheduleId, date} = ctx.session;
        if (!service) return showServices(ctx, true);
        const start = Number(ctx.match[1]);
        // Кнопка могла остаться в старом сообщении — время уже прошло или занято
        if (!(await isSlotAvailable(new Date(start), service, rescheduleId))) {
            return ctx.editMessageText(TEXTS.booking.slotGone, {
                reply_markup: new InlineKeyboard().text(B.chooseAgain, date ? `date:${date}` : "months"),
            });
        }
        await continueWithTime(ctx.api, ctx.chat!.id, ctx.session, start, {
            messageId: ctx.callbackQuery.message?.message_id,
            otherTime: `date:${ctx.session.date}`,
        });
    });

    // ---------- Шаг 6: телефон ----------
    const phoneKeyboard = new Keyboard().requestContact(B.sharePhone).resized().oneTime();

    bot.on("message:contact", async (ctx, next) => {
        if (ctx.session.step !== "phone") return next();
        await acceptPhone(ctx, ctx.message.contact.phone_number);
    });

    async function acceptPhone(ctx: Ctx, raw: string) {
        const phone = normalizePhone(raw);
        if (!phone) return ctx.reply(TEXTS.booking.phoneInvalid);

        ctx.session.phone = phone;
        ctx.session.step = "comment";
        ctx.session.photos = [];
        await ctx.reply(TEXTS.booking.phoneThanks, {reply_markup: {remove_keyboard: true}});
        await ctx.reply(TEXTS.booking.askComment, {
            reply_markup: new InlineKeyboard().text(B.skipComment, "cmt_skip"),
        });
    }

    // ---------- Шаг 7: комментарий / фото-референс ----------
    bot.callbackQuery("cmt_skip", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session.step !== "comment") return;
        await ctx.editMessageReplyMarkup();
        await showConfirm(ctx);
    });

    bot.on("message:photo", async (ctx, next) => {
        const s = ctx.session;
        const groupId = ctx.message.media_group_id;
        if (s.step !== "comment" && s.step !== "confirm") return next();
        // Остальные фото того же альбома приходят отдельными сообщениями — просто добавляем их;
        // отдельное фото после сводки — добавляем и показываем сводку заново
        const sameAlbum = s.step === "confirm" && groupId !== undefined && groupId === s.mediaGroup;

        s.photos ??= [];
        if (s.photos.length < MAX_PHOTOS) s.photos.push(ctx.message.photo.at(-1)!.file_id);
        const caption = ctx.message.caption?.trim();
        if (caption) s.comment = s.comment ? `${s.comment}\n${caption}` : caption;

        if (sameAlbum) return;
        s.mediaGroup = groupId;
        await showConfirm(ctx);
    });

    // ---------- Текстовые ответы (имя, телефон, комментарий, отзыв) ----------
    bot.on("message:text", async (ctx, next) => {
        const text = ctx.message.text.trim();
        if (text.startsWith("/")) return next();

        switch (ctx.session.step) {
            case "name":
                if (text.length < 2 || text.length > 60) return ctx.reply(TEXTS.booking.nameInvalid);
                ctx.session.name = text;
                ctx.session.step = "phone";
                return ctx.reply(TEXTS.booking.askPhone, {
                    reply_markup: phoneKeyboard,
                });

            case "phone":
                return acceptPhone(ctx, text);

            case "comment":
                ctx.session.comment = text.slice(0, 1000);
                return showConfirm(ctx);

            case "review":
                return saveReviewText(ctx, text.slice(0, 2000));

            default:
                if (isMaster(ctx)) return showMasterPanel(ctx);
                return ctx.reply(TEXTS.menu.chooseAction, {reply_markup: mainMenu()});
        }
    });

    // ---------- Шаг 8: подтверждение ----------
    async function showConfirm(ctx: Ctx) {
        const {service, start, name, phone, comment, photos} = ctx.session;
        if (!service || !start || !name || !phone) {
            reset(ctx);
            return ctx.reply(TEXTS.booking.somethingWrong, {reply_markup: mainMenu()});
        }

        ctx.session.step = "confirm";
        const s = SERVICES[service];
        await ctx.reply(
            TEXTS.booking.summary({
                service: s.title,
                when: formatDateTime(new Date(start)),
                name: escapeHtml(name),
                phone,
                comment: comment && escapeHtml(comment),
                hasPhotos: Boolean(photos?.length),
            }),
            {
                parse_mode: "HTML",
                reply_markup: new InlineKeyboard().text(B.confirm, "confirm").text(B.abort, "abort"),
            },
        );
    }

    bot.callbackQuery("abort", async (ctx) => {
        reset(ctx);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(TEXTS.booking.aborted, {reply_markup: mainMenu()});
    });

    bot.callbackQuery("confirm", async (ctx) => {
        const {step, service, start, name, phone, comment, photos} = ctx.session;
        if (step !== "confirm" || !service || !start || !name || !phone) {
            // Обычно это повторное нажатие уже после записи — сообщение не трогаем, чтобы не затереть «Вы записаны»
            return ctx.answerCallbackQuery(TEXTS.booking.sessionExpiredToast);
        }
        await ctx.answerCallbackQuery();

        let result;
        try {
            result = await createBooking(ctx.api, {
                name,
                phone,
                telegramId: ctx.from.id,
                telegramUsername: ctx.from.username,
                service,
                start: new Date(start),
                comment,
                photos,
            });
        } catch (err) {
            // Сессию не сбрасываем — клиент может нажать «Подтвердить» ещё раз
            reportError("Создание записи", err);
            return ctx.reply(TEXTS.booking.saveFailed);
        }
        reset(ctx);

        if (!result.ok) {
            return ctx.editMessageText(TEXTS.booking.slotTaken, {
                reply_markup: new InlineKeyboard().text(B.chooseAgain, "book"),
            });
        }

        const s = SERVICES[service];
        const kb = new InlineKeyboard().text(B.my, "my");
        if (hasLocation()) kb.text(B.location, "location");
        await ctx.editMessageText(TEXTS.booking.booked(s.title, formatDateTime(result.booking.start)), {
            reply_markup: kb,
        });
    });

    // ---------- Мои записи / отмена / перенос ----------
    async function showMyBookings(ctx: Ctx, edit = false) {
        const list = await db
            .select()
            .from(bookings)
            .where(and(eq(bookings.telegramId, ctx.from!.id), eq(bookings.status, "active"), gt(bookings.start, new Date())))
            .orderBy(asc(bookings.start));

        const kb = new InlineKeyboard();
        let text: string;
        if (!list.length) {
            text = TEXTS.myBookings.empty;
            kb.text(B.book, "book").row();
        } else {
            text = TEXTS.myBookings.list;
            for (const b of list) {
                const title = SERVICES[b.service]?.shortTitle ?? b.serviceTitle;
                kb.text(B.bookingItem(formatShortDateTime(b.start), title), `mybk:${b.id}`).row();
            }
            kb.text(B.bookMore, "book").row();
        }
        kb.text(B.menu, "menu");
        if (edit) await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
        else await ctx.reply(text, {parse_mode: "HTML", reply_markup: kb});
    }

    /** Карточка записи клиента: перенос / отмена (если ещё можно) и «Как добраться». */
    /** Активная запись клиента. */
    async function findClientBooking(telegramId: number, id: number): Promise<Booking | undefined> {
        const [b] = await db
            .select()
            .from(bookings)
            .where(and(eq(bookings.id, id), eq(bookings.telegramId, telegramId), eq(bookings.status, "active")));
        return b;
    }

    bot.callbackQuery(/^mybk:(\d{1,9})$/, async (ctx) => {
        const b = await findClientBooking(ctx.from.id, Number(ctx.match[1]));
        if (!b || b.start.getTime() <= Date.now()) {
            await ctx.answerCallbackQuery(TEXTS.myBookings.notFound);
            return showMyBookings(ctx, true);
        }
        await ctx.answerCallbackQuery();

        let text = TEXTS.myBookings.card({
            service: b.serviceTitle,
            when: formatDateTime(b.start),
            comment: b.comment ? escapeHtml(b.comment) : undefined,
            confirmed: Boolean(b.clientConfirmedAt),
        });
        const kb = new InlineKeyboard();
        if (canModify(b.start)) {
            kb.text(B.move, `resched:${b.id}`).text(B.cancelBooking, `cancelask:${b.id}`).row();
        } else {
            text += "\n\n" + TEXTS.myBookings.deadlineNote(config.modifyDeadlineHours);
        }
        if (hasLocation()) kb.text(B.location, "location").row();
        kb.text(B.toMyBookings, "my");
        await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
    });

    bot.callbackQuery("my", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showMyBookings(ctx, true);
    });

    /** Найти активную запись клиента, которую ещё можно менять; иначе ответить и вернуть undefined. */
    async function findModifiable(ctx: Ctx & { from: NonNullable<Ctx["from"]> }, id: number) {
        const booking = await findClientBooking(ctx.from.id, id);
        if (!booking) {
            await ctx.answerCallbackQuery(TEXTS.myBookings.notFound);
            await showMyBookings(ctx, true);
            return undefined;
        }
        if (!canModify(booking.start)) {
            await ctx.answerCallbackQuery({text: TEXTS.myBookings.tooLate(config.modifyDeadlineHours), show_alert: true});
            await showMyBookings(ctx, true);
            return undefined;
        }
        return booking;
    }

    bot.callbackQuery(/^cancelask:(\d{1,9})$/, async (ctx) => {
        const booking = await findModifiable(ctx, Number(ctx.match[1]));
        if (!booking) return;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(TEXTS.myBookings.cancelAsk(booking.serviceTitle, formatDateTime(booking.start)), {
            reply_markup: new InlineKeyboard()
                .text(B.cancelYes, `cancel:${booking.id}`).row()
                .text(B.cancelNo, `mybk:${booking.id}`),
        });
    });

    bot.callbackQuery(/^cancel:(\d{1,9})$/, async (ctx) => {
        const found = await findModifiable(ctx, Number(ctx.match[1]));
        if (!found) return;
        const booking = await cancelBooking(ctx.api, found.id);
        if (!booking) {
            await ctx.answerCallbackQuery(TEXTS.myBookings.notFound);
            return showMyBookings(ctx, true);
        }
        await ctx.answerCallbackQuery(TEXTS.myBookings.cancelledToast);
        await ctx.editMessageText(TEXTS.myBookings.cancelled(booking.serviceTitle, formatDateTime(booking.start)), {
            reply_markup: new InlineKeyboard().text(B.my, "my").text(B.book, "book"),
        });
    });

    bot.callbackQuery(/^resched:(\d{1,9})$/, async (ctx) => {
        const booking = await findModifiable(ctx, Number(ctx.match[1]));
        if (!booking) return;
        await ctx.answerCallbackQuery();
        ctx.session = {step: "idle", service: booking.service, rescheduleId: booking.id};
        await showMonths(ctx);
    });

    bot.callbackQuery("resched_ok", async (ctx) => {
        const {rescheduleId, start, byMaster} = ctx.session;
        reset(ctx);
        if (byMaster && rescheduleId && start) return confirmMasterReschedule(ctx, rescheduleId, start);
        if (!rescheduleId || !start) {
            await ctx.answerCallbackQuery(TEXTS.myBookings.sessionExpiredToast);
            return showMyBookings(ctx, true);
        }

        const booking = await findModifiable(ctx, rescheduleId);
        if (!booking) return;
        await ctx.answerCallbackQuery();

        const result = await rescheduleBooking(ctx.api, booking, new Date(start));
        if (!result.ok) {
            return ctx.editMessageText(TEXTS.booking.slotTaken, {
                reply_markup: new InlineKeyboard().text(B.my, "my"),
            });
        }
        await ctx.editMessageText(TEXTS.booking.rescheduled(formatDateTime(result.booking.start)), {
            reply_markup: new InlineKeyboard().text(B.my, "my"),
        });
    });

    // ---------- Подтверждение из напоминания ----------
    bot.callbackQuery(/^rconfirm:(\d{1,9})$/, async (ctx) => {
        const booking = await findClientBooking(ctx.from.id, Number(ctx.match[1]));
        if (!booking) {
            await ctx.answerCallbackQuery(TEXTS.myBookings.notFound);
            return ctx.editMessageReplyMarkup();
        }
        await ctx.answerCallbackQuery(TEXTS.reminders.thanksToast);
        const kb = hasLocation() ? new InlineKeyboard().text(B.location, "location") : undefined;
        await ctx.editMessageText(TEXTS.reminders.confirmed(booking.serviceTitle, formatDateTime(booking.start)), {
            reply_markup: kb,
        });
        // Атомарно: мастер получит уведомление один раз, даже при повторных нажатиях
        const [confirmed] = await db
            .update(bookings)
            .set({clientConfirmedAt: new Date()})
            .where(and(eq(bookings.id, booking.id), isNull(bookings.clientConfirmedAt)))
            .returning();
        if (confirmed) await notifyMasterClientConfirmed(ctx.api, confirmed).catch(logNotifyError);
    });

    // ---------- Отзывы ----------
    bot.callbackQuery(/^rate:(\d{1,9}):([1-5])$/, async (ctx) => {
        const id = Number(ctx.match[1]);
        const rating = Number(ctx.match[2]);
        const [booking] = await db
            .update(bookings)
            .set({reviewRating: rating, reviewPublished: false, reviewCreatedAt: new Date()})
            .where(and(eq(bookings.id, id), eq(bookings.telegramId, ctx.from.id), isNull(bookings.reviewRating)))
            .returning();
        if (!booking) {
            const [exists] = await db
                .select({id: bookings.id})
                .from(bookings)
                .where(and(eq(bookings.id, id), eq(bookings.telegramId, ctx.from.id)));
            if (!exists) return ctx.answerCallbackQuery(TEXTS.reviews.notFound);
            await ctx.answerCallbackQuery(TEXTS.reviews.alreadyLeft);
            return ctx.editMessageReplyMarkup();
        }
        await ctx.answerCallbackQuery();
        // Оценку мастер видит сразу — даже если клиент так и не напишет текст
        await notifyMasterReview(ctx.api, booking).catch(logNotifyError);

        ctx.session = {step: "review", reviewBookingId: booking.id};
        await ctx.editMessageText(TEXTS.reviews.askText(stars(rating)), {
            reply_markup: new InlineKeyboard().text(B.skipReview, "rv_skip"),
        });
    });

    async function saveReviewText(ctx: Ctx, text: string) {
        const id = ctx.session.reviewBookingId;
        reset(ctx);
        if (id) {
            const [booking] = await db
                .update(bookings)
                .set({reviewText: text})
                .where(and(eq(bookings.id, id), isNotNull(bookings.reviewRating)))
                .returning();
            // Повторное уведомление — уже с текстом и кнопкой публикации
            if (booking) await notifyMasterReview(ctx.api, booking).catch(logNotifyError);
        }
        await ctx.reply(TEXTS.reviews.thanksText, {reply_markup: mainMenu()});
    }

    bot.callbackQuery("rv_skip", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session.step === "review") reset(ctx);
        await ctx.editMessageText(TEXTS.reviews.thanksRating, {reply_markup: mainMenu()});
    });

    async function showReviews(ctx: Ctx, edit = false) {
        const reviewed = await db
            .select()
            .from(bookings)
            .where(eq(bookings.reviewPublished, true))
            .orderBy(desc(bookings.reviewCreatedAt))
            .limit(10);
        const text = reviewed.length
            ? TEXTS.reviews.list(
                reviewed.map((b) => ({
                    stars: stars(b.reviewRating ?? 0),
                    text: escapeHtml(b.reviewText ?? ""),
                    name: escapeHtml(b.name),
                })),
            )
            : TEXTS.reviews.empty;
        const kb = new InlineKeyboard().text(B.book, "book").row().text(B.menu, "menu");
        if (edit) await ctx.editMessageText(text, {parse_mode: "HTML", reply_markup: kb});
        else await ctx.reply(text, {parse_mode: "HTML", reply_markup: kb});
    }

    bot.callbackQuery("reviews", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showReviews(ctx, true);
    });

    // Модерация отзывов — только мастер
    bot.callbackQuery(/^rv(pub|hide):(\d{1,9})$/, async (ctx) => {
        if (!isMaster(ctx)) return ctx.answerCallbackQuery(MASTER_TEXTS.review.forbidden);
        const [booking] = await db
            .update(bookings)
            .set({reviewPublished: ctx.match[1] === "pub"})
            .where(and(eq(bookings.id, Number(ctx.match[2])), isNotNull(bookings.reviewRating)))
            .returning();
        if (!booking) return ctx.answerCallbackQuery(MASTER_TEXTS.review.notFound);
        await ctx.answerCallbackQuery(
            booking.reviewPublished ? MASTER_TEXTS.review.publishedToast : MASTER_TEXTS.review.hiddenToast,
        );
        await ctx.editMessageText(reviewMasterText(booking), {
            parse_mode: "HTML",
            reply_markup: reviewModerationKeyboard(booking),
        });
    });

    registerMaster(bot, {showMonths});

    bot.catch((err) => {
        const e = err.error;
        // Игнорируем "message is not modified" при повторных нажатиях
        if (e instanceof GrammyError && e.description.includes("message is not modified")) return;
        reportError(`Обработка update ${err.ctx.update.update_id}`, e);
    });

    return bot;
}
