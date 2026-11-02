import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

/**
 * قاعدة البيانات:
 * - DATABASE_URL يبدأ بـ "pglite:" ⇒ قاعدة PostgreSQL مدمجة داخل المشروع (للتشغيل المحلي بلا تثبيت)
 * - غير ذلك ⇒ PostgreSQL حقيقي (Neon / خادم) — للنشر
 */
export const isLite = (process.env.DATABASE_URL ?? "pglite:").startsWith("pglite:");
export const liteDir = () => path.resolve((process.env.DATABASE_URL ?? "pglite:./data/db").replace(/^pglite:/, "") || "./data/db");

type G = { __lffDb?: NodePgDatabase<typeof schema> };
const g = globalThis as unknown as G;

function create(): NodePgDatabase<typeof schema> {
  if (isLite) {
    fs.mkdirSync(liteDir(), { recursive: true });
    const client = new PGlite(liteDir());
    return drizzleLite(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  return drizzlePg(pool, { schema });
}

export const db = g.__lffDb ?? (g.__lffDb = create());
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
