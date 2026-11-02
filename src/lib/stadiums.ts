import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stadiums, clubs } from "@/db/schema";

export type Stadium = typeof stadiums.$inferSelect;

/** سبب منع إقامة مباراة على الملعب في تاريخ معيّن (null = مسموح) */
export function stadiumBlock(s: Stadium | undefined | null, day: string | null): string | null {
  if (!s) return null;
  if (s.status === "CLOSED") return `الملعب «${s.name}» مغلق`;
  if (s.status === "SUSPENDED" && (!s.suspendedUntil || !day || s.suspendedUntil >= day))
    return `الملعب «${s.name}» موقوف${s.suspendedUntil ? ` حتى ${s.suspendedUntil}` : ""}${s.suspensionReason ? ` — ${s.suspensionReason}` : ""}`;
  if (s.approvalUntil && day && s.approvalUntil < day) return `انتهى اعتماد الملعب «${s.name}» في ${s.approvalUntil} — تلزم معاينة جديدة`;
  return null;
}

export async function allStadiums() {
  return db.select().from(stadiums).orderBy(stadiums.name);
}

/** يربط اسم الملعب المكتوب بسجل الملاعب (مطابقة الاسم) */
export async function resolveStadium(name: string | null) {
  if (!name?.trim()) return null;
  const [s] = await db.select().from(stadiums).where(eq(stadiums.name, name.trim()));
  return s ?? null;
}

/** ملعبا النادي (الأساسي والاحتياطي) */
export async function clubStadiums(clubId: number) {
  const [c] = await db.select({ main: clubs.mainStadiumId, backup: clubs.backupStadiumId }).from(clubs).where(eq(clubs.id, clubId));
  const all = c ? await db.select().from(stadiums) : [];
  return { main: all.find((s) => s.id === c?.main) ?? null, backup: all.find((s) => s.id === c?.backup) ?? null };
}

/** رسالة المنع مع اقتراح الملعب الاحتياطي للنادي المضيف إن كان متاحًا */
export async function blockWithHint(block: string, homeClubId: number, day: string | null) {
  const { main, backup } = await clubStadiums(homeClubId);
  const alt = [backup, main].find((s) => s && !stadiumBlock(s, day));
  return alt ? `${block} — الملعب ${alt.id === backup?.id ? "الاحتياطي" : "الأساسي"} للنادي المضيف: «${alt.name}»` : block;
}
