/**
 * Все тексты, которые видит клиент.
 * Функции получают уже отформатированные значения (дату, время, экранированные строки).
 * В текстах с HTML-разметкой можно использовать <b>, <i>, <code>.
 */
export const TEXTS = {
    welcome: `Привет🫂 
Меня зовут Динара. 
Я визажист и стилист по волосам ✨
Здесь вы можете выбрать услугу, посмотреть свободные даты и записаться ко мне на создание полного образа.

Буду рада стать частью вашего особенного дня ✨`,

    commands: {
        start: "Главное меню",
        book: "Записаться",
        my: "Мои записи",
        location: "Как добраться",
        reviews: "Отзывы",
        cancel: "Прервать запись",
    },

    buttons: {
        book: "📅 Записаться",
        my: "📋 Мои записи",
        location: "📍 Как добраться",
        reviews: "⭐ Отзывы",
        back: "« Назад",
        menu: "« Меню",
        openCalendar: "🗓 Выбрать дату и время",
        toMonths: "« К месяцам",
        toCalendar: "« К календарю",
        otherTime: "« Другое время",
        prevMonth: (month: string) => `‹ ${month}`,
        nextMonth: (month: string) => `${month} ›`,
        sharePhone: "📱 Отправить мой номер",
        skipComment: "Пропустить »",
        confirm: "✅ Подтвердить",
        abort: "✖️ Отменить",
        chooseAgain: "📅 Выбрать заново",
        reschedule: "✅ Перенести",
        bookingItem: (when: string, service: string) => `${when} · ${service}`,
        bookMore: "📅 Записаться ещё",
        toMyBookings: "« К моим записям",
        cancelBooking: "✖️ Отменить запись",
        cancelYes: "Да, отменить",
        cancelNo: "« Нет, оставить",
        iConfirm: "✅ Подтверждаю",
        move: "✏️ Перенести",
        cancel: "✖️ Отменить",
        rate: (n: number) => `${n} ⭐`,
        skipReview: "Пропустить",
    },

    calendar: {
        weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
        months: [
            "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
        ],
        /** Подсказки при нажатии на недоступный день */
        off: {
            past: "Эта дата уже прошла",
            closed: "Запись на эту дату пока не открыта",
            busy: "На эту дату нет свободного времени",
        },
    },

    menu: {
        flowCancelled: "Хорошо, запись прервана.",
        whatNext: "Что хотите сделать?",
        chooseAction: "Выберите действие:",
    },

    myId: (id: number | string) => `Ваш ID: <code>${id}</code>`,

    location: {
        fallback: "Адрес Динара пришлёт вам лично 🤍",
        address: (address: string) => `📍 <b>${address}</b>`,
    },

    booking: {
        chooseService: "Выберите услугу:",
        unknownService: "Неизвестная услуга",
        rescheduleHeader: (serviceTitle: string) => `🔁 Перенос записи\n${serviceTitle}`,
        chooseMonth: (header: string) => `${header}\nВыберите месяц:`,
        noSlots: "К сожалению, свободных окон пока нет. Напишите Динаре напрямую 🤍",
        chooseDay: (header: string, month: string) => `${header}\n📅 ${month} — выберите день:`,
        chooseTime: (header: string, date: string) => `${header}\n🗓 ${date} — выберите время:`,
        noTimeOnDate: "На эту дату свободного времени уже нет, выберите другую.",
        rescheduleConfirm: (when: string) => `🔁 Перенести запись на <b>${when}</b>?`,
        selected: (serviceTitle: string, when: string) => `<b>${serviceTitle}</b>, ${when}`,

        askName: "Как вас зовут?",
        nameInvalid: "Пожалуйста, введите имя (2–60 символов).",
        askPhone: "Оставьте номер телефона — нажмите кнопку ниже или введите вручную:",
        phoneInvalid: "Не получилось распознать номер. Пример: +7 900 123-45-67",
        phoneThanks: "Спасибо!",
        askComment:
            "Хотите что-то добавить? Напишите, на какое событие образ и ваши пожелания — " +
            "можно прислать фото-референс 📎",

        summary: (p: {service: string; when: string; name: string; phone: string; comment?: string; hasPhotos: boolean}) =>
            [
                "<b>Проверьте запись:</b>",
                "",
                `💄 ${p.service}`,
                `🗓 ${p.when}`,
                `👤 ${p.name}`,
                `📞 ${p.phone}`,
                p.comment ? `💬 ${p.comment}` : "",
                p.hasPhotos ? "📎 Фото-референс прикреплён" : "",
            ]
                .filter((l, i) => l || i === 1)
                .join("\n"),

        aborted: "Запись отменена.",
        somethingWrong: "Что-то пошло не так, давайте начнём заново.",
        sessionExpiredToast: "Сессия устарела, начните заново",
        sessionExpired: "Сессия устарела. Начните запись заново.",
        slotTaken: "Упс, это время только что заняли 😔 Выберите другое.",
        slotGone: "Это время уже недоступно 😔 Выберите другое.",
        saveFailed: "Не получилось сохранить запись 😔 Попробуйте нажать «Подтвердить» ещё раз чуть позже.",
        booked: (serviceTitle: string, when: string) =>
            `✅ Вы записаны!\n\n💄 ${serviceTitle}\n🗓 ${when}\n\n` +
            "Я напомню о записи за день и за 2 часа. Динара свяжется с вами для уточнения деталей 🤍",
        rescheduled: (when: string) => `✅ Запись перенесена на ${when}`,
    },

    /** Уведомления клиенту, когда запись изменила Динара */
    byMaster: {
        cancelled: (serviceTitle: string, when: string) =>
            `😔 Динара отменила вашу запись:\n\n💄 ${serviceTitle}\n🗓 ${when}\n\n` +
            "Если есть вопросы — напишите ей напрямую. Записаться на другое время можно через меню.",
        rescheduled: (serviceTitle: string, oldWhen: string, when: string) =>
            `🔁 Динара перенесла вашу запись:\n\n💄 ${serviceTitle}\n🗓 Было: ${oldWhen}\n🗓 Стало: <b>${when}</b>\n\n` +
            "Если новое время не подходит — напишите Динаре или измените запись в «Мои записи».",
    },

    myBookings: {
        empty: "У вас нет предстоящих записей.",
        list: "<b>Ваши записи</b>\nНажмите на запись, чтобы перенести или отменить её:",
        card: (p: {service: string; when: string; comment?: string; confirmed: boolean}) =>
            [
                "<b>Ваша запись</b>",
                "",
                `💄 ${p.service}`,
                `🗓 ${p.when}`,
                p.comment ? `💬 ${p.comment}` : "",
                p.confirmed ? "\n✅ Вы подтвердили запись" : "",
            ]
                .filter((l, i) => l || i === 1)
                .join("\n"),
        cancelAsk: (service: string, when: string) =>
            `Отменить запись?\n\n💄 ${service}\n🗓 ${when}`,
        cancelled: (service: string, when: string) =>
            `❌ Запись отменена\n\n💄 ${service}\n🗓 ${when}\n\nБудем рады видеть вас в другой раз 🤍`,
        deadlineNote: (hours: number) =>
            `<i>Изменить или отменить запись можно не позднее чем за ${hours} ч до начала.</i>`,
        tooLate: (hours: number) =>
            `Изменить или отменить запись можно не позднее чем за ${hours} ч до начала. ` +
            "Пожалуйста, напишите Динаре напрямую.",
        notFound: "Запись не найдена",
        cancelledToast: "Запись отменена",
        sessionExpiredToast: "Сессия устарела",
    },

    reminders: {
        dayBefore: (serviceTitle: string, when: string) =>
            `🤍 Напоминаю о записи завтра:\n\n💄 ${serviceTitle}\n🗓 ${when}\n\nПожалуйста, подтвердите, что всё в силе.`,
        twoHours: (serviceTitle: string, when: string) => `🤍 Жду вас через 2 часа!\n\n💄 ${serviceTitle}\n🗓 ${when}`,
        thanksToast: "Спасибо!",
        confirmed: (serviceTitle: string, when: string) =>
            `✅ Запись подтверждена — жду вас!\n\n💄 ${serviceTitle}\n🗓 ${when}`,
    },

    reviews: {
        request: (name: string, serviceTitle: string) =>
            `${name}, спасибо, что были у меня 🤍\nКак вам ${serviceTitle.toLowerCase()}? Оцените, пожалуйста, от 1 до 5:`,
        askText: (stars: string) =>
            `Ваша оценка: ${stars}\n\nНапишите пару слов о впечатлениях — мне это очень важно 🤍`,
        alreadyLeft: "Вы уже оставили отзыв, спасибо!",
        thanksText: "Спасибо за отзыв! 🤍 Буду рада видеть вас снова.",
        thanksRating: "Спасибо за оценку! 🤍 Буду рада видеть вас снова.",
        list: (items: {stars: string; text: string; name: string}[]) =>
            "<b>Отзывы клиентов</b>\n\n" +
            items.map((r) => `${r.stars}\n${r.text}\n— <i>${r.name}</i>`).join("\n\n"),
        empty: "Отзывов пока нет 🤍",
        notFound: "Запись не найдена",
    },
};
