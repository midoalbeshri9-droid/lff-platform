"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, registrations, clubs, seasons, registrationEvents, divisions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { inScopeClub, scopeOf } from "@/lib/scope";
import { categoryFor } from "@/lib/registration";
import { UserError } from "@/lib/util";

export type ImportRow = { card: string; name: string; dob: string | null; approx: boolean; nat: string; shirt: number | null };
export type ImportResult = { card: string; ok: boolean; playerId?: number; msg: string };
const BY = "استيراد نادٍ من Excel";
const norm = (x: string) => x.replace(/^\s*نادي\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "");

/** إنشاء النادي (إن لزم) ثم اللاعبين وقيودهم المعتمدة في الموسم الحالي — على دفعات */
export async function importClubChunk(input: { clubId?: number; newClub?: { name: string; divisionId: number | null; region: string | null }; rows: ImportRow[] }):
  Promise<{ ok: boolean; msg?: string; clubId?: number; results: ImportResult[] }> {
  try {
    const u = await requireUser("reg.edit");
    const [season] = await db.select().from(seasons).where(eq(seasons.isCurrent, true));
    if (!season) throw new UserError("لا يوجد موسم حالي — حدّده من إعدادات القيد");
    let clubId = input.clubId;
    if (!clubId && input.newClub) {
      if (!u.can("admin.clubs")) throw new UserError("إنشاء نادٍ جديد من صلاحية الإدارة — اختر ناديًا موجودًا");
      const name = input.newClub.name.trim().replace(/\s+/g, " ");
      if (name.length < 2) throw new UserError("اكتب اسم النادي");
      const all = await db.select({ id: clubs.id, name: clubs.name }).from(clubs);
      const ex = all.find((c) => norm(c.name) === norm(name));
      if (ex) clubId = ex.id;
      else {
        const dv = input.newClub.divisionId ? (await db.select({ id: divisions.id }).from(divisions).where(eq(divisions.id, input.newClub.divisionId)))[0]?.id ?? null : null;
        [{ id: clubId }] = await db.insert(clubs).values({ name, divisionId: dv, region: input.newClub.region || null }).returning({ id: clubs.id });
        await audit(u, "إنشاء نادٍ (استيراد Excel)", "Club", clubId, name);
      }
    }
    if (!clubId) throw new UserError("اختر النادي");
    if (!(await inScopeClub(u, clubId))) throw new UserError("النادي خارج نطاق درجتك");
    const sc = await scopeOf(u);
    const [club] = await db.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, clubId));
    const results: ImportResult[] = [];
    for (const r of input.rows.slice(0, 60)) {
      const card = r.card.replace(/\s+/g, "").toUpperCase(), name = r.name.replace(/\s+/g, " ").trim();
      if (!name) { results.push({ card, ok: false, msg: "بلا اسم" }); continue; }
      if (!r.dob) { results.push({ card, ok: false, msg: "بلا تاريخ ميلاد — لم يُدخل" }); continue; }
      let [p] = card ? await db.select().from(players).where(eq(players.cardNo, card)) : [];
      if (!p && !r.approx) [p] = await db.select().from(players).where(and(eq(players.dateOfBirth, r.dob), sql`regexp_replace(${players.fullName}, '\\s+', '', 'g') = ${name.replace(/\s+/g, "")}`));
      if (p) {
        const [reg] = await db.select({ c: registrations.clubId }).from(registrations)
          .where(and(eq(registrations.playerId, p.id), eq(registrations.seasonId, season.id), inArray(registrations.status, ["APPROVED", "SUBMITTED", "NEEDS_CORRECTION", "DRAFT"])));
        if (reg) {
          if (reg.c === clubId) { results.push({ card, ok: true, playerId: p.id, msg: "مقيّد مسبقًا في النادي" }); continue; }
          const [o] = await db.select({ n: clubs.name }).from(clubs).where(eq(clubs.id, reg.c));
          results.push({ card, ok: false, msg: `له قيد هذا الموسم مع ${o?.n ?? "نادٍ آخر"} — لم يُدخل` }); continue;
        }
        if (sc && p.createdByClubId == null) {
          // مدير الدرجة لا يعدّل لاعبًا موجودًا خارج درجته
          const [any] = await db.select({ c: registrations.clubId }).from(registrations).where(eq(registrations.playerId, p.id)).limit(1);
          if (any && !sc.clubIds.includes(any.c)) { results.push({ card, ok: false, msg: "اللاعب مسجل في درجة أخرى — لم يُدخل" }); continue; }
        }
        if (card && !p.cardNo) await db.update(players).set({ cardNo: card }).where(eq(players.id, p.id));
      } else {
        [p] = await db.insert(players).values({
          fullName: name, fullNameEn: /^[\x00-\x7F]+$/.test(name) ? name : null, cardNo: card || null, dateOfBirth: r.dob,
          nationality: r.nat || "ليبي", isForeign: !!r.nat && r.nat !== "ليبي",
          notes: r.approx ? "تاريخ الميلاد تقريبي (السنة من رقم البطاقة) — يُستكمل" : null,
        }).returning();
      }
      const cat = await categoryFor(r.dob, season.startDate);
      const free = card ? !(await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.number, card))).length : false;
      const [reg] = await db.insert(registrations).values({
        playerId: p.id, clubId, seasonId: season.id, type: "RENEWAL", status: "APPROVED", number: free ? card : null,
        categoryId: cat?.id ?? null, shirtNumber: r.shirt, notes: "مستورد من ملف Excel للنادي",
        submittedAt: new Date(), submittedBy: u.fullName, decidedAt: new Date(), decidedBy: `${u.fullName} (${BY})`,
      }).returning();
      await db.insert(registrationEvents).values({ registrationId: reg.id, userName: u.fullName, action: "استيراد واعتماد القيد", note: BY });
      results.push({ card, ok: true, playerId: p.id, msg: r.approx ? "أُدخل — تاريخ الميلاد تقريبي" : "أُدخل" });
    }
    const n = results.filter((x) => x.ok).length;
    await audit(u, BY, "Club", clubId, { club: club?.name, season: season.name, imported: n, skipped: results.length - n });
    return { ok: true, clubId, results };
  } catch (e) {
    return { ok: false, msg: e instanceof UserError ? e.message : "تعذر الاستيراد", results: [] };
  }
}
