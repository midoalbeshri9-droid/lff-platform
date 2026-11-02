import "dotenv/config";
import path from "path";
import fs from "fs";
import { defineConfig } from "drizzle-kit";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "pglite:./data/db";
const lite = url.startsWith("pglite:");
if (lite) fs.mkdirSync(path.resolve(url.replace(/^pglite:/, "")), { recursive: true });

export default lite
  ? defineConfig({ schema: "./src/db/schema.ts", out: "./drizzle", dialect: "postgresql", driver: "pglite", dbCredentials: { url: path.resolve(url.replace(/^pglite:/, "")) } })
  : defineConfig({ schema: "./src/db/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url } });
