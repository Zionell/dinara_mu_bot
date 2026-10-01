/**
 * «Как добраться» — заполните, и в меню бота появится кнопка 📍.
 * Координаты: в Яндекс/Google Картах нажмите на точку → скопируйте широту и долготу.
 */
export const LOCATION = {
    title: "Студия Динары",
    address: "Краснодар, ул. Дальняя, 39/3",
    latitude: 45.061207,
    longitude: 38.964691,
    directions: "5 этаж, каб. 502",
};

export const hasLocation = () => Boolean(LOCATION.address || LOCATION.directions);
