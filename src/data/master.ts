/**
 * Тексты для мастера (Динары): уведомления в Telegram и события в Google Calendar.
 * Функции получают уже отформатированные и экранированные значения.
 */
export const MASTER_TEXTS = {
    bookingCard: (p: {service: string; when: string; name: string; phone: string; telegram: string; comment?: string}) =>
        [
            `💄 ${p.service}`,
            `🗓 ${p.when}`,
            `👤 ${p.name}`,
            `📞 ${p.phone}`,
            `✉️ ${p.telegram}`,
            p.comment ? `💬 ${p.comment}` : "",
        ]
            .filter(Boolean)
            .join("\n"),
    profileLink: "профиль",
    /** Меню команд мастера (клиентские «Записаться», «Мои записи», «Как добраться» ему не показываем) */
    commands: {
        master: "Записи",
        reviews: "Отзывы",
    },

    newBooking: (card: string) => `🔔 <b>Новая запись</b>\n\n${card}`,
    reminder2h: (card: string) => `⏰ <b>Через 2 часа запись</b>\n\n${card}`,
    openBooking: "📋 Открыть запись",
    cancelled: (card: string) => `❌ <b>Запись отменена клиентом</b>\n\n${card}`,
    rescheduled: (oldWhen: string, card: string) => `🔁 <b>Запись перенесена</b>\nБыло: ${oldWhen}\n\n${card}`,
    clientConfirmed: (card: string) => `✅ <b>Клиент подтвердил запись</b>\n\n${card}`,
    photoCaption: (name: string) => `📎 Референс от ${name}`,
    photosCaption: (name: string) => `📎 Референсы от ${name}`,

    /** Панель мастера: просмотр, отмена и перенос записей */
    panel: {
        title: "👩‍🎨 <b>Панель мастера</b>\nЗаписи, отмена и перенос, отзывы.",
        forbidden: "Недоступно",
        buttons: {
            today: "📅 Сегодня",
            tomorrow: "📆 Завтра",
            upcoming: "🗓 Все предстоящие",
            reviews: "⭐ Отзывы",
            toReviews: "« К отзывам",
            review: (stars: string, name: string) => `${stars} · ${name}`,
            panel: "« Панель",
            prevDay: "‹ Пред. день",
            nextDay: "След. день ›",
            prevPage: "‹ Назад",
            nextPage: "Дальше ›",
            reschedule: "🔁 Перенести",
            cancel: "✖️ Отменить",
            cancelYes: "Да, отменить",
            cancelNo: "« Нет",
            photos: (n: number) => `📎 Референсы (${n})`,
            toDay: "« К дню",
            booking: (time: string, name: string) => `${time} · ${name}`,
            bookingWithDate: (when: string, name: string) => `${when} · ${name}`,
        },
        day: (date: string, lines: string[]) =>
            `📅 <b>${date}</b>\n\n` + (lines.length ? lines.join("\n") : "<i>Записей нет</i>"),
        dayLine: (p: {from: string; to: string; service: string; name: string; confirmed: boolean}) =>
            `${p.confirmed ? "✅" : "▫️"} <b>${p.from}–${p.to}</b> ${p.service} — ${p.name}`,
        upcoming: (lines: string[]) =>
            "🗓 <b>Предстоящие записи</b>\n\n" + (lines.length ? lines.join("\n") : "<i>Записей нет</i>"),
        upcomingLine: (p: {when: string; service: string; name: string; confirmed: boolean}) =>
            `${p.confirmed ? "✅" : "▫️"} <b>${p.when}</b> ${p.service} — ${p.name}`,
        legend: "\n\n<i>✅ — клиент подтвердил</i>",
        card: (card: string, status: string) => `📋 <b>Запись</b>\n\n${card}\n\n${status}`,
        status: {
            active: "Статус: активна",
            confirmed: "Статус: ✅ клиент подтвердил",
            cancelled: "Статус: ❌ отменена",
            past: "Статус: прошла",
        },
        cancelAsk: (card: string) => `Отменить запись?\nКлиент получит уведомление.\n\n${card}`,
        cancelledToast: "Запись отменена",
        notFound: "Запись не найдена",
        notActive: "Запись уже отменена или прошла",
        slotTaken: "😔 Это время уже занято, выберите другое.",
        rescheduled: (card: string) => `✅ <b>Запись перенесена</b>\nКлиент получил уведомление.\n\n${card}`,
        reviews: (lines: string[]) =>
            "⭐ <b>Отзывы</b>\n\n" + (lines.length ? lines.join("\n") : "<i>Отзывов пока нет</i>"),
        reviewLine: (p: {stars: string; name: string; when: string; published: boolean}) =>
            `${p.published ? "📢" : "▫️"} ${p.stars} <b>${p.name}</b> · ${p.when}`,
        reviewsLegend: "\n\n<i>📢 — опубликован</i>",
    },

    review: {
        card: (p: {stars: string; name: string; service: string; when: string; text?: string; published: boolean; isNew: boolean}) =>
            [
                `💌 <b>${p.isNew ? "Новый отзыв" : "Отзыв"}</b> ${p.stars}`,
                `${p.name} · ${p.service} · ${p.when}`,
                p.text ? `\n${p.text}` : "\n<i>без текста</i>",
                p.published ? "\n📢 Опубликован" : "",
            ].join("\n"),
        publishButton: "📢 Опубликовать",
        hideButton: "🙈 Скрыть",
        publishedToast: "Опубликовано",
        hiddenToast: "Скрыто",
        notFound: "Отзыв не найден",
        forbidden: "Недоступно",
    },

    calendarEvent: {
        summary: (service: string, name: string) => `${service} — ${name}`,
        description: (p: {name: string; phone: string; telegram: string; comment?: string; photos: number}) =>
            [
                `Клиент: ${p.name}`,
                `Телефон: ${p.phone}`,
                `Telegram: ${p.telegram}`,
                p.comment ? `\nКомментарий: ${p.comment}` : "",
                p.photos ? `📎 Фото-референсы (${p.photos}) — в Telegram` : "",
            ]
                .filter(Boolean)
                .join("\n"),
    },
};
