"use server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { roundDecisions, counters, competitionStages, matches, type DecisionContent } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { guard, inScopeComp } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { attempt, int, str, UserError, today } from "@/lib/util";
import { draftFor, regenerate, decisionHeader } from "@/lib/decisions";
import { and } from "drizzle-orm";

async function load(id: number) {
  const [x] = await db.select().from(roundDecisions).where(eq(roundDecisions.id, id));
  if (!x) throw new UserError("القرار غير موجود");
  return x;
}

/** إنشاء مسودة قرار الجولة (أو فتحها إن وُجدت) */
export async function createDecision(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!, round = int(f, "round")!;
  let to = "/competitions";
  await attempt(() => to, async () => {
    const [st] = await db.select().from(competitionStages).where(eq(competitionStages.id, stageId));
    if (!st) throw new UserError("المرحلة غير موجودة");
    to = `/competitions/${st.competitionId}?tab=decisions`;
    guard(await inScopeComp(u, st.competitionId));
    const [ex] = await db.select({ id: roundDecisions.id }).from(roundDecisions).where(and(eq(roundDecisions.stageId, stageId), eq(roundDecisions.round, round)));
    if (ex) { to = `/competitions/decisions/${ex.id}`; return "القرار موجود — فُتح للتعديل"; }
    const [m] = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.stageId, stageId), eq(matches.round, round))).limit(1);
    if (!m) throw new UserError("لا مباريات في هذه الجولة");
    const content = await draftFor(stageId, round);
    const [n] = await db.insert(roundDecisions).values({ competitionId: st.competitionId, stageId, round, content, createdBy: u.fullName }).returning();
    await audit(u, "إنشاء مسودة قرار جولة", "RoundDecision", n.id, { stage: st.name, round });
    to = `/competitions/decisions/${n.id}`;
    return "أُنشئت مسودة القرار من بيانات الجولة — راجعها وعدّلها ثم أصدرها";
  });
}

function clean(raw: unknown): DecisionContent {
  const c = raw as DecisionContent;
  const s = (v: unknown) => String(v ?? "").slice(0, 4000);
  const rows = (r: unknown) => (Array.isArray(r) ? r.slice(0, 400).map((x) => Object.fromEntries(Object.entries(x as object).map(([k, v]) => [k, s(v)]))) : []);
  const list = (a: unknown) => (Array.isArray(a) ? a : []).map(s).filter((x) => x.trim());
  if (!c || typeof c !== "object") throw new UserError("محتوى غير صالح");
  return {
    subject: s(c.subject), preamble: (Array.isArray(c.preamble) ? c.preamble : []).map(s).filter((x) => x.trim()),
    resultsIntro: s(c.resultsIntro), results: (Array.isArray(c.results) ? c.results : []).map((g) => ({ group: s(g.group), rows: rows(g.rows) })),
    playersIntro: s(c.playersIntro), players: rows(c.players), staffIntro: s(c.staffIntro), staff: rows(c.staff),
    banArticle: s(c.banArticle),
    playerSanctions: list(c.playerSanctions), staffSanctions: list(c.staffSanctions), clubSanctions: list(c.clubSanctions), fanSanctions: list(c.fanSanctions),
    extra: (Array.isArray(c.extra) ? c.extra : []).map((e) => ({ title: s(e.title), body: s(e.body) })).filter((e) => e.body.trim()),
    closing: s(c.closing), signerName: s(c.signerName), signerTitle: s(c.signerTitle),
  };
}

export async function saveDecision(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  const op = str(f, "op");
  await attempt(`/competitions/decisions/${id}`, async () => {
    const d = await load(id);
    guard(await inScopeComp(u, d.competitionId));
    if (d.status === "ISSUED") throw new UserError("القرار صادر ولا يُعدَّل — ألغِ الإصدار أولًا (مدير المنظومة)");
    let content: DecisionContent;
    try { content = clean(JSON.parse(String(f.get("content") ?? ""))); } catch (e) { if (e instanceof UserError) throw e; throw new UserError("محتوى غير صالح"); }
    const number = str(f, "number"), issueDate = str(f, "issueDate");
    if (op === "regen") content = await regenerate(d.stageId, d.round, content);
    await db.update(roundDecisions).set({ content, number, issueDate, updatedAt: new Date() }).where(eq(roundDecisions.id, id));
    if (op === "issue") {
      const { season } = await decisionHeader(d.stageId);
      let num = number;
      if (!num) {
        const [row] = await db.insert(counters).values({ key: `decision:${season}`, value: 1 })
          .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } }).returning();
        num = String(row.value).padStart(2, "0");
      }
      await db.update(roundDecisions).set({ number: num, issueDate: issueDate ?? today(), status: "ISSUED", issuedBy: u.fullName, issuedAt: new Date() }).where(eq(roundDecisions.id, id));
      await audit(u, "إصدار قرار جولة", "RoundDecision", id, { number: num });
      return `صدر القرار رقم (${num}) — يمكنك طباعته الآن`;
    }
    await audit(u, op === "regen" ? "تحديث قرار جولة من بيانات المنظومة" : "حفظ مسودة قرار جولة", "RoundDecision", id);
    return op === "regen" ? "حُدّثت النتائج والإنذارات والعقوبات من بيانات المنظومة (الصفوف اليدوية بقيت كما هي)" : "حُفظت المسودة";
  });
}

export async function decisionAdmin(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  const op = str(f, "op");
  let to = `/competitions/decisions/${id}`;
  await attempt(() => to, async () => {
    const d = await load(id);
    guard(await inScopeComp(u, d.competitionId));
    if (op === "reopen") {
      if (u.role !== "ADMIN") throw new UserError("إلغاء إصدار القرار لمدير المنظومة فقط");
      await db.update(roundDecisions).set({ status: "DRAFT" }).where(eq(roundDecisions.id, id));
      await audit(u, "إلغاء إصدار قرار جولة", "RoundDecision", id, { number: d.number });
      return "أُعيد القرار إلى مسودة";
    }
    if (op === "delete") {
      if (d.status === "ISSUED") throw new UserError("لا يُحذف قرار صادر");
      await db.delete(roundDecisions).where(eq(roundDecisions.id, id));
      await audit(u, "حذف مسودة قرار جولة", "RoundDecision", id);
      to = `/competitions/${d.competitionId}?tab=decisions`;
      return "حُذفت المسودة";
    }
  });
}
