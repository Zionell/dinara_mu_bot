import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });
export const db = drizzle(pool, { schema });

/** Папка с SQL-миграциями лежит в корне проекта (рядом с src/ и dist/). */
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function migrateDb() {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

export async function isDbAlive(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

/** Нарушение exclusion-constraint (пересечение записей по времени). */
export function isOverlapError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}
