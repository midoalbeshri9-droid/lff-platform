"use server";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { players, registrations, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { scopeOf, inScopePlayer } from "@/lib/scope";
import { saveUpload, ALLOWED_IMG } from "@/lib/storage";
import { UserError } from "@/lib/util";

export type CardMatch = { card: string; playerId: number; name: string; club: string | null; hasPhoto: boolean; inScope: boolean };

/** مطابقة أرقام البطاقات باللاعبين في المنظومة */
export async function lookupCards(cards: string[]): Promise<CardMatch[]> {
  const u = await requireUser("reg.edit");
  const list = [...new Set(cards.map((c) => c.replace(/\s+/g, "").toUpperCase()).filter(Boolean))].slice(0, 2000);
  if (!list.length) return [];
  const ps = await db.select({ id: players.id, card: players.cardNo, name: players.fullName, photo: players.photoKey }).from(players).where(inArray(players.cardNo, list));
  const sc = await scopeOf(u);
  const out: CardMatch[] = [];
  for (const p of ps) {
    const [r] = await db.select({ club: clubs.name }).from(registrations).innerJoin(clubs, eq(clubs.id, registrations.clubId))
      .where(and(eq(registrations.playerId, p.id), eq(registrations.status, "APPROVED"))).orderBy(desc(registrations.id)).limit(1);
    out.push({ card: p.card!, playerId: p.id, name: p.name, club: r?.club ?? null, hasPhoto: !!p.photo, inScope: !sc || (await inScopePlayer(u, p.id)) });
  }
  return out;
}

/** حفظ صورة لاعب واحدة (تُرسل الصور واحدة واحدة لتجنب حد حجم الطلب) */
export async function setPlayerPhoto(fd: FormData): Promise<{ ok: boolean; msg: string }> {
  try {
    const u = await requireUser("reg.edit");
    const playerId = Number(fd.get("playerId"));
    const replace = fd.get("replace") === "1";
    if (!(await inScopePlayer(u, playerId))) throw new UserError("اللاعب خارج نطاق درجتك");
    const [p] = await db.select({ photo: players.photoKey, name: players.fullName }).from(players).where(eq(players.id, playerId));
    if (!p) throw new UserError("اللاعب غير موجود");
    if (p.photo && !replace) return { ok: true, msg: "لديه صورة — لم تُستبدل" };
    const file = fd.get("photo") as File | null;
    if (!file || !file.size) throw new UserError("لا توجد صورة");
    const saved = await saveUpload(file, "photos", ALLOWED_IMG, 3 * 1048576);
    await db.update(players).set({ photoKey: saved.key, photoHash: saved.hash }).where(eq(players.id, playerId));
    await audit(u, p.photo ? "استبدال صورة لاعب (استيراد Excel)" : "إضافة صورة لاعب (استيراد Excel)", "Player", playerId, String(fd.get("source") ?? ""));
    return { ok: true, msg: p.photo ? "استُبدلت الصورة" : "أُضيفت الصورة" };
  } catch (e) {
    return { ok: false, msg: e instanceof UserError ? e.message : "تعذر الحفظ" };
  }
}
