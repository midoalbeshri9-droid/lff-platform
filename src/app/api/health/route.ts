import { sql } from "drizzle-orm";
import { db } from "@/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
