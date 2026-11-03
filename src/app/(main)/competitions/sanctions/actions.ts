"use server";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { sanctions, sanctionArticles, appeals, settings } from "@/db/schema";
import { requireUser, requireClubUser } from "@/lib/auth";
import { guard, inScopeClub, inScopeComp, inScopeMatch, inScopePlayer, inScopeStaff, inScopeSanction } from "@/lib/scope";
import { audit, notifyClub, notifyRoles, notifyStaff } from "@/lib/audit";
import { issueSanction, revokeSanction, amendSanction, type SanctionInput } from "@/lib/sanctions";
import { saveUpload } from "@/lib/storage";
import { attempt, str, req, int, num, UserError, today } from "@/lib/util";

export async function createSanction(f: FormData) {
  const u = await requireUser("comp.sanctions");
  let id = 0;
  await attempt("/competitions/sanctions/new", async () => {
    const articleId = int(f, "articleId");
    let articleText = str(f, "articleText");
    if (articleId) {
      const [a] = await db.select().from(sanctionArticles).where(eq(sanctionArticles.id, articleId));
      articleText = a ? `المادة ${a.code}: ${a.title}` : articleText;
    }
    const i: SanctionInput = {
      targetType: req(f, "targetType", "الجهة") as "PLAYER", playerId: int(f, "playerId"), staffId: int(f, "staffId"), clubId: int(f, "clubId")!,
      competitionId: int(f, "competitionId"), matchId: int(f, "matchId"), articleId, articleText,
      type: req(f, "type", "نوع العقوبة") as "WARNING", matchesCount: int(f, "matchesCount"), fromDate: str(f, "fromDate"), toDate: str(f, "toDate"),
      points: int(f, "points"), fineAmount: num(f, "fineAmount"), reason: req(f, "reason", "السبب"), decisionDate: str(f, "decisionDate"), notes: str(f, "notes"),
    };
    if (!i.clubId) throw new UserError("اختر النادي");
    guard(await inScopeClub(u, i.clubId));
    if (i.competitionId) guard(await inScopeComp(u, i.competitionId));
    if (i.matchId) guard(await inScopeMatch(u, i.matchId));
    if (i.playerId) guard(await inScopePlayer(u, i.playerId));
    if (i.staffId) guard(await inScopeStaff(u, i.staffId));
    await db.transaction(async (tx) => {
      const s = await issueSanction(tx, i, u.fullName);
      id = s.id;
      await audit(u, "إصدار قرار عقوبة", "Sanction", s.id, { number: s.number, type: i.type }, tx);
    });
  }).catch((e) => {
    if (id) redirect(`/competitions/sanctions/${id}?ok=${encodeURIComponent("صدر القرار وطُبقت آثاره وأُبلغ النادي")}`);
    throw e;
  });
}

export async function revoke(f: FormData) {
  const u = await requireUser("comp.sanctions");
  const id = int(f, "id")!;
  await attempt(`/competitions/sanctions/${id}`, async () => {
    guard(await inScopeSanction(u, id));
    const reason = req(f, "reason", "سبب الإلغاء");
    await db.transaction(async (tx) => {
      await revokeSanction(tx, id, u.fullName);
      await tx.update(sanctions).set({ notes: `أُلغي: ${reason}` }).where(eq(sanctions.id, id));
      await audit(u, "إلغاء عقوبة", "Sanction", id, reason, tx);
    });
    const [s] = await db.select().from(sanctions).where(eq(sanctions.id, id));
    await notifyClub(s.clubId, `إلغاء القرار ${s.number}`, reason, "/club/sanctions");
    return "أُلغيت العقوبة وكل آثارها";
  });
}

export async function amend(f: FormData) {
  const u = await requireUser("comp.sanctions");
  const id = int(f, "id")!;
  await attempt(`/competitions/sanctions/${id}`, async () => {
    guard(await inScopeSanction(u, id));
    await db.transaction(async (tx) => {
      await amendSanction(tx, id, { matchesCount: int(f, "matchesCount"), toDate: str(f, "toDate"), points: int(f, "points"), fineAmount: num(f, "fineAmount") }, u.fullName);
      await audit(u, "تعديل عقوبة", "Sanction", id, null, tx);
    });
    return "تم تعديل العقوبة وتحديث آثارها";
  });
}

export async function markCompleted(f: FormData) {
  const u = await requireUser("comp.sanctions");
  const id = int(f, "id")!;
  await attempt(`/competitions/sanctions/${id}`, async () => {
    guard(await inScopeSanction(u, id));
    await db.update(sanctions).set({ status: "COMPLETED" }).where(eq(sanctions.id, id));
    await audit(u, "تعليم عقوبة منفّذة", "Sanction", id);
    return "تم";
  });
}

/** طعن النادي على قرار */
export async function submitAppeal(f: FormData) {
  const u = await requireClubUser("club.appeals");
  await attempt("/club/sanctions", async () => {
    const id = int(f, "sanctionId")!;
    const [s] = await db.select().from(sanctions).where(and(eq(sanctions.id, id), eq(sanctions.clubId, u.clubId)));
    if (!s || s.status !== "ACTIVE") throw new UserError("القرار غير قابل للطعن");
    if (s.appealDeadline && s.appealDeadline < today()) throw new UserError("انتهت مهلة الطعن");
    const [open] = await db.select().from(appeals).where(and(eq(appeals.sanctionId, id), eq(appeals.status, "PENDING")));
    if (open) throw new UserError("يوجد طعن قيد النظر");
    const doc = f.get("document") as File | null;
    const documentKey = doc && doc.size ? (await saveUpload(doc, `docs/${u.clubId}`)).key : null;
    await db.insert(appeals).values({ sanctionId: id, clubId: u.clubId, text: req(f, "text", "نص الطعن"), documentKey, submittedBy: u.fullName });
    await db.update(sanctions).set({ status: "APPEALED" }).where(eq(sanctions.id, id));
    await notifyStaff(["COMP_HEAD"], `طعن على القرار ${s.number}`, u.clubName, `/competitions/sanctions/${id}`, { clubId: u.clubId });
    await audit(u, "تقديم طعن", "Sanction", id);
    return "تم تقديم الطعن — ستصلك النتيجة في الإشعارات";
  });
}

export async function decideAppeal(f: FormData) {
  const u = await requireUser("comp.sanctions");
  const id = int(f, "id")!, appealId = int(f, "appealId")!;
  await attempt(`/competitions/sanctions/${id}`, async () => {
    guard(await inScopeSanction(u, id));
    const decision = String(f.get("decision")) as "ACCEPTED" | "REJECTED" | "REDUCED";
    const text = req(f, "decisionText", "نص القرار");
    await db.transaction(async (tx) => {
      await tx.update(appeals).set({ status: decision, decision: text, decidedBy: u.fullName, decidedAt: new Date() }).where(eq(appeals.id, appealId));
      if (decision === "ACCEPTED") await revokeSanction(tx, id, u.fullName);
      else if (decision === "REDUCED") await amendSanction(tx, id, { matchesCount: int(f, "matchesCount"), toDate: str(f, "toDate"), points: int(f, "points"), fineAmount: num(f, "fineAmount") }, u.fullName);
      else await tx.update(sanctions).set({ status: "ACTIVE" }).where(eq(sanctions.id, id));
      await audit(u, "قرار في طعن", "Sanction", id, { decision, text }, tx);
    });
    const [s] = await db.select().from(sanctions).where(eq(sanctions.id, id));
    await notifyClub(s.clubId, `نتيجة الطعن على ${s.number}`, text, "/club/sanctions");
    return "تم البت في الطعن وإبلاغ النادي";
  });
}

export async function saveArticle(f: FormData) {
  const u = await requireUser("comp.articles");
  await attempt("/competitions/articles", async () => {
    const id = int(f, "id");
    const data = {
      code: req(f, "code", "رقم المادة"), title: req(f, "title", "العنوان"), body: str(f, "body"), target: str(f, "target"),
      defaultType: (str(f, "defaultType") as "FINE") ?? null, minMatches: int(f, "minMatches"), maxMatches: int(f, "maxMatches"),
      minFine: num(f, "minFine"), maxFine: num(f, "maxFine"), isActive: f.has("isActive") ? f.get("isActive") === "on" : true,
    };
    if (id) await db.update(sanctionArticles).set(data).where(eq(sanctionArticles.id, id));
    else await db.insert(sanctionArticles).values(data);
    await audit(u, "حفظ مادة لائحة", "SanctionArticle", id, data.code);
    return "تم حفظ المادة";
  });
}

export async function saveAppealDays(f: FormData) {
  const u = await requireUser("comp.articles");
  await attempt("/competitions/articles", async () => {
    const v = String(int(f, "appeal_days") ?? 7);
    await db.insert(settings).values({ key: "appeal_days", value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
    await audit(u, "مهلة الطعن", "Setting", null, v);
    return "تم الحفظ";
  });
}
