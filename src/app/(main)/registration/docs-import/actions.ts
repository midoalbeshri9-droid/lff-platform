"use server";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, registrations, clubs, registrationDocuments, documentTypes } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { scopeOf, inScopePlayer, regIn } from "@/lib/scope";
import { getCurrentSeason } from "@/lib/registration";
import { saveUpload, ALLOWED_DOC, ALLOWED_IMG } from "@/lib/storage";
import { UserError } from "@/lib/util";
import type { Dir } from "@/lib/docClassify";

/** دليل لاعبي الموسم الحالي (ضمن نطاق المستخدم) لمطابقة المجلدات */
export async function playerDirectory(): Promise<Dir[]> {
  const u = await requireUser("reg.edit");
  const season = await getCurrentSeason();
  if (!season) return [];
  const sc = await scopeOf(u);
  const rows = await db.select({ id: players.id, name: players.fullName, nameEn: players.fullNameEn, card: players.cardNo, club: clubs.name }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .where(and(eq(registrations.seasonId, season.id), inArray(registrations.status, ["APPROVED", "SUBMITTED", "NEEDS_CORRECTION", "DRAFT"]), sc ? regIn(sc) : undefined));
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** رفع ملف واحد لملف اللاعب: الصورة الشخصية أو مستند (يُلحق بآخر قيد للاعب ويُعتمد) */
export async function uploadPlayerFile(fd: FormData): Promise<{ ok: boolean; msg: string }> {
  try {
    const u = await requireUser("reg.edit");
    const playerId = Number(fd.get("playerId"));
    if (!(await inScopePlayer(u, playerId))) throw new UserError("اللاعب خارج نطاق درجتك");
    const file = fd.get("file") as File | null;
    if (!file || !file.size) throw new UserError("ملف فارغ");
    const kind = String(fd.get("kind") ?? "");
    const [p] = await db.select({ name: players.fullName, photo: players.photoKey }).from(players).where(eq(players.id, playerId));
    if (!p) throw new UserError("اللاعب غير موجود");
    if (kind === "photo") {
      if (p.photo && fd.get("replace") !== "1") return { ok: true, msg: "لديه صورة — لم تُستبدل" };
      const s = await saveUpload(file, "photos", ALLOWED_IMG, 4 * 1048576);
      await db.update(players).set({ photoKey: s.key, photoHash: s.hash }).where(eq(players.id, playerId));
      await audit(u, p.photo ? "استبدال صورة لاعب (رفع ملف اللاعب)" : "إضافة صورة لاعب (رفع ملف اللاعب)", "Player", playerId, file.name);
      return { ok: true, msg: p.photo ? "استُبدلت الصورة الشخصية" : "أُضيفت الصورة الشخصية" };
    }
    const typeId = Number(kind);
    const [t] = await db.select({ name: documentTypes.name }).from(documentTypes).where(eq(documentTypes.id, typeId));
    if (!t) throw new UserError("نوع المستند غير صحيح");
    const [r] = await db.select({ id: registrations.id, clubId: registrations.clubId }).from(registrations)
      .where(eq(registrations.playerId, playerId)).orderBy(desc(registrations.id)).limit(1);
    if (!r) throw new UserError("لا يوجد قيد للاعب يُلحق به المستند");
    // منع تكرار نفس الملف لنفس اللاعب
    const dup = await db.select({ id: registrationDocuments.id }).from(registrationDocuments).innerJoin(registrations, eq(registrations.id, registrationDocuments.registrationId))
      .where(and(eq(registrations.playerId, playerId), eq(registrationDocuments.originalName, file.name), eq(registrationDocuments.size, file.size))).limit(1);
    if (dup.length) return { ok: true, msg: "موجود مسبقًا في ملف اللاعب" };
    const s = await saveUpload(file, `docs/${r.clubId}`, ALLOWED_DOC);
    const now = new Date();
    await db.insert(registrationDocuments).values({ registrationId: r.id, documentTypeId: typeId, fileKey: s.key, originalName: file.name, mime: file.type, size: file.size,
      status: "APPROVED", uploadedBy: u.fullName, reviewedAt: now, reviewedBy: u.fullName });
    await audit(u, "إضافة مستند لملف اللاعب", "Player", playerId, { type: t.name, file: file.name });
    return { ok: true, msg: `أُضيف: ${t.name}` };
  } catch (e) {
    return { ok: false, msg: e instanceof UserError ? e.message : "تعذر الرفع" };
  }
}
