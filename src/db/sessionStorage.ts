import { eq } from "drizzle-orm";
import type { StorageAdapter } from "grammy";
import { db } from "./index.js";
import { sessions } from "./schema.js";

/**
 * Хранилище сессий grammY в PostgreSQL.
 * Пустые сессии (`isEmpty`) не храним — в таблице только незавершённые сценарии.
 */
export function pgSessionStorage<T>(isEmpty: (value: T) => boolean): StorageAdapter<T> {
  return {
    async read(key) {
      const [row] = await db.select({ value: sessions.value }).from(sessions).where(eq(sessions.key, key));
      return row?.value as T | undefined;
    },
    async write(key, value) {
      if (isEmpty(value)) {
        await db.delete(sessions).where(eq(sessions.key, key));
        return;
      }
      await db
        .insert(sessions)
        .values({ key, value })
        .onConflictDoUpdate({ target: sessions.key, set: { value, updatedAt: new Date() } });
    },
    async delete(key) {
      await db.delete(sessions).where(eq(sessions.key, key));
    },
  };
}
