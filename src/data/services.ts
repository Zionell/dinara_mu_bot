export type ServiceKey = "makeup" | "hair" | "full";

export interface Service {
    key: ServiceKey;
    title: string;
    /** Короткое название — для кнопок в списке записей */
    shortTitle: string;
    durationMin: number;
}

/** Услуги: название (как видит клиент) и длительность в минутах. */
export const SERVICES: Record<ServiceKey, Service> = {
    makeup: {key: "makeup", title: "Макияж", shortTitle: "Макияж", durationMin: 90},
    hair: {key: "hair", title: "Причёска", shortTitle: "Причёска", durationMin: 90},
    full: {key: "full", title: "Полный образ (макияж + укладка)", shortTitle: "Полный образ", durationMin: 180},
};
