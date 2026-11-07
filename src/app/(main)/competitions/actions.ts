"use server";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionTeams, matches, matchEvents, assignments, matchRequests, competitionSquads, matchSquads, registrations, clubs, competitionStages, stageTeams, settings, staff } from "@/db/schema";
import { addCharge } from "@/lib/finance";
import { resolveStadium, stadiumBlock, blockWithHint } from "@/lib/stadiums";
import { guard, inScopeClub, inScopeComp, inScopeMatch, inScopeStage, scopeOf } from "@/lib/scope";
import { foreignOnPitchCheck, subsLimitCheck } from "@/lib/competition";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub, notifyOfficial } from "@/lib/audit";
import { approveMatch, standings } from "@/lib/competition";
import {
  ensureStages, templateStages, addToFirstStage, removeFromStages, generateStageFixtures, clearStageFixtures, drawGroups, setGroups, groupsByRegion,
  nextKnockoutRound, qualifyToNext, getStage, manualKoPairs,
} from "@/lib/stages";
import { saveLineup } from "@/lib/lineup";
import { deleteCompetitionCascade } from "@/lib/compDelete";
import { attempt, str, req, int, ints, num, UserError, fromLocalInput, dayOf } from "@/lib/util";

export async function saveCompetition(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id");
  await attempt(id ? `/competitions/${id}?tab=settings` : "/competitions", async () => {
    if (id) guard(await inScopeComp(u, id));
    const data = {
      seasonId: int(f, "seasonId")!, name: req(f, "name", "اسم المسابقة"), type: (str(f, "type") ?? "LEAGUE") as "LEAGUE",
      categoryId: int(f, "categoryId"), legs: int(f, "legs") ?? 2, pointsWin: int(f, "pointsWin") ?? 3, pointsDraw: int(f, "pointsDraw") ?? 1,
      squadMax: int(f, "squadMax") ?? 18, startersCount: int(f, "startersCount") ?? 11, maxForeign: int(f, "maxForeign"),
      maxForeignOnPitch: int(f, "maxForeignOnPitch"), squadListMax: int(f, "squadListMax"), yellowRules: str(f, "yellowRules"), entryFee: num(f, "entryFee"),
      yellowThreshold: int(f, "yellowThreshold") ?? 3, redBanMatches: int(f, "redBanMatches") ?? 1, startDate: str(f, "startDate"), notes: str(f, "notes"),
      tiebreak: ["H2H", "GD"].includes(str(f, "tiebreak") ?? "") ? str(f, "tiebreak")! : "LFF",
      // مدير الدرجة: مسابقاته في درجته دائمًا
      divisionId: u.divisionId ?? int(f, "divisionId"),
      maxSubs: int(f, "maxSubs") ?? 3, maxSubsExtra: int(f, "maxSubsExtra") ?? 1, maxLowerCategory: int(f, "maxLowerCategory"),
      noForeignGK: f.has("noForeignGK") ? f.get("noForeignGK") === "1" : true, forfeitGoals: int(f, "forfeitGoals") ?? 2,
    };
    if (id) await db.update(competitions).set(data).where(eq(competitions.id, id));
    else {
      const [c] = await db.insert(competitions).values(data).returning();
      const st = templateStages(c.type, c.legs, { groupsCount: int(f, "groupsCount"), qualifyPerGroup: int(f, "qualifyPerGroup"), koLegs: int(f, "koLegs") });
      await db.insert(competitionStages).values(st.map((x, i) => ({ ...x, competitionId: c.id, status: (i === 0 ? "ACTIVE" : "PENDING") as "ACTIVE" })));
    }
    await audit(u, id ? "تعديل مسابقة" : "إنشاء مسابقة", "Competition", id, data.name);
    return "تم حفظ المسابقة";
  });
}

export async function setCompetitionStatus(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}`, async () => {
    guard(await inScopeComp(u, id));
    const status = str(f, "status") as "DRAFT" | "ACTIVE" | "FINISHED";
    await db.update(competitions).set({ status }).where(eq(competitions.id, id));
    await audit(u, "تغيير حالة مسابقة", "Competition", id, status);
    return "تم التحديث";
  });
}

export async function addTeams(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}?tab=teams`, async () => {
    guard(await inScopeComp(u, id));
    for (const c of ints(f, "club")) guard(await inScopeClub(u, c));
    const clubIds = ints(f, "club");
    if (!clubIds.length) throw new UserError("اختر ناديًا واحدًا على الأقل");
    const group = str(f, "groupName");
    const added = await db.insert(competitionTeams).values(clubIds.map((clubId) => ({ competitionId: id, clubId, groupName: group }))).onConflictDoNothing().returning();
    await addToFirstStage(id, added.map((t) => t.clubId), group);
    const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
    if (Number(c.entryFee) > 0) for (const t of added) await addCharge(db, { clubId: t.clubId, category: "ENTRY_FEE", description: `رسوم الاشتراك في ${c.name}`, amount: c.entryFee!, refType: "compteam", refId: t.id, createdBy: u.fullName });
    await audit(u, "إضافة فرق لمسابقة", "Competition", id, clubIds);
    return `تمت إضافة ${clubIds.length} فريق`;
  });
}

export async function removeTeam(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}?tab=teams`, async () => {
    guard(await inScopeComp(u, id));
    const clubId = int(f, "clubId")!;
    const [m] = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.competitionId, id), or(eq(matches.homeClubId, clubId), eq(matches.awayClubId, clubId)))).limit(1);
    if (m) throw new UserError("للفريق مباريات مجدولة — احذف الجدول أولًا");
    await db.delete(competitionTeams).where(and(eq(competitionTeams.competitionId, id), eq(competitionTeams.clubId, clubId)));
    await removeFromStages(id, clubId);
    await audit(u, "حذف فريق من مسابقة", "Competition", id, clubId);
    return "تم الحذف";
  });
}

const stageBack = (id: number, stageId?: number | null) => `/competitions/${id}?tab=stages${stageId ? `&stage=${stageId}` : ""}`;

export async function makeFixtures(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  const stageId = int(f, "stageId");
  await attempt(stageId ? stageBack(id, stageId) : `/competitions/${id}?tab=fixtures`, async () => {
    guard(await inScopeComp(u, id));
    if (stageId) guard(await inScopeStage(u, stageId));
    const st = await ensureStages(id);
    const target = stageId ?? (st.find((x) => x.status !== "DONE") ?? st[0]).id;
    const n = await generateStageFixtures(target);
    await audit(u, "إنشاء جدول المباريات", "Competition", id, { stage: target, matches: n });
    return `تم إنشاء ${n} مباراة — حدّد مواعيدها من تبويب «الجدول والمباريات»`;
  });
}

export async function clearFixtures(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  const stageId = int(f, "stageId");
  await attempt(stageId ? stageBack(id, stageId) : `/competitions/${id}?tab=fixtures`, async () => {
    guard(await inScopeComp(u, id));
    if (stageId) guard(await inScopeStage(u, stageId));
    if (stageId) await clearStageFixtures(stageId);
    else {
      const played = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.competitionId, id), ne(matches.reportStatus, "NONE"))).limit(1);
      if (played.length) throw new UserError("توجد مباريات لها تقارير — لا يمكن حذف الجدول");
      await db.delete(matches).where(eq(matches.competitionId, id));
    }
    await audit(u, "حذف جدول المباريات", "Competition", id, { stage: stageId });
    return "تم حذف الجدول";
  });
}

// ---------------- مراحل المسابقة ----------------
function stageData(f: FormData) {
  const format = (str(f, "format") ?? "LEAGUE") as "LEAGUE" | "GROUPS" | "KNOCKOUT";
  return {
    name: req(f, "name", "اسم المرحلة"), format,
    legs: Math.max(1, Math.min(4, int(f, "legs") ?? (format === "KNOCKOUT" ? 1 : 2))),
    finalLegs: Math.max(1, Math.min(2, int(f, "finalLegs") ?? 1)),
    groupsCount: format === "GROUPS" ? int(f, "groupsCount") : null,
    qualifyPerGroup: int(f, "qualifyPerGroup"), notes: str(f, "notes"),
    qualifyBest: format === "GROUPS" ? int(f, "qualifyBest") || null : null,
    pointsWin: int(f, "pointsWin"), pointsDraw: int(f, "pointsDraw"),
    carryPoints: format !== "KNOCKOUT" && ["FULL", "HALF"].includes(str(f, "carryPoints") ?? "") ? str(f, "carryPoints")! : "NONE",
    koPairing: ["SEEDED", "RANK", "DRAW", "MANUAL"].includes(str(f, "koPairing") ?? "") ? str(f, "koPairing")! : "SEEDED",
    tieDecider: str(f, "tieDecider") === "PENS" ? "PENS" : "ET_PENS",
    thirdPlace: format === "KNOCKOUT" && f.get("thirdPlace") === "1",
    resetYellows: f.get("resetYellows") === "1",
    finalVenue: format === "KNOCKOUT" ? str(f, "finalVenue") : null,
  };
}

export async function addStage(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}?tab=stages`, async () => {
    guard(await inScopeComp(u, id));
    const st = await ensureStages(id);
    const data = stageData(f);
    const [s] = await db.insert(competitionStages).values({ ...data, competitionId: id, seq: (st[st.length - 1]?.seq ?? 0) + 1 }).returning();
    await audit(u, "إضافة مرحلة", "Competition", id, data.name);
    return `تمت إضافة المرحلة «${s.name}» — تتأهل إليها الفرق من المرحلة السابقة أو أضفها يدويًا`;
  });
}

export async function saveStage(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const data = stageData(f);
    const [m] = await db.select({ id: matches.id }).from(matches).where(eq(matches.stageId, stageId)).limit(1);
    if (m && data.format !== s.format) throw new UserError("لا يمكن تغيير نظام مرحلة مجدولة — احذف جدولها أولًا");
    await db.update(competitionStages).set(data).where(eq(competitionStages.id, stageId));
    await audit(u, "تعديل مرحلة", "Competition", s.competitionId, data.name);
    return "تم حفظ المرحلة";
  });
}

export async function deleteStage(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(`/competitions/${s.competitionId}?tab=stages`, async () => {
    guard(await inScopeStage(u, stageId));
    const [m] = await db.select({ id: matches.id }).from(matches).where(eq(matches.stageId, stageId)).limit(1);
    if (m) throw new UserError("للمرحلة مباريات — احذف جدولها أولًا");
    const st = await ensureStages(s.competitionId);
    if (st.length === 1) throw new UserError("لا بد من مرحلة واحدة على الأقل");
    await db.delete(competitionStages).where(eq(competitionStages.id, stageId));
    // إعادة ترقيم المراحل
    let seq = 1;
    for (const x of st.filter((x) => x.id !== stageId)) await db.update(competitionStages).set({ seq: seq++ }).where(eq(competitionStages.id, x.id));
    await audit(u, "حذف مرحلة", "Competition", s.competitionId, s.name);
    return "تم حذف المرحلة";
  });
}

export async function stageAddTeams(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    for (const c of ints(f, "club")) guard(await inScopeClub(u, c));
    const ids = ints(f, "club");
    if (!ids.length) throw new UserError("اختر فريقًا");
    const [m] = await db.select({ id: matches.id }).from(matches).where(eq(matches.stageId, stageId)).limit(1);
    if (m) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
    await db.insert(stageTeams).values(ids.map((clubId) => ({ stageId, clubId, groupName: str(f, "groupName") }))).onConflictDoNothing();
    await audit(u, "إضافة فرق لمرحلة", "Competition", s.competitionId, { stage: s.name, ids });
    return `تمت إضافة ${ids.length} فريق للمرحلة`;
  });
}

export async function stageRemoveTeam(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const [m] = await db.select({ id: matches.id }).from(matches).where(eq(matches.stageId, stageId)).limit(1);
    if (m) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
    await db.delete(stageTeams).where(and(eq(stageTeams.stageId, stageId), eq(stageTeams.clubId, int(f, "clubId")!)));
    await audit(u, "حذف فريق من مرحلة", "Competition", s.competitionId, { stage: s.name });
    return "تم الحذف";
  });
}

export async function stageDraw(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const count = int(f, "groupsCount") ?? s.groupsCount ?? 2;
    const seeded = f.get("mode") === "seeded" ? ints(f, "seedOrder") : undefined;
    await drawGroups(stageId, count, seeded);
    await audit(u, "قرعة المجموعات", "Competition", s.competitionId, { stage: s.name, count, seeded: !!seeded });
    return `تمت القرعة على ${count} مجموعات`;
  });
}

export async function stageRegionGroups(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const map = await groupsByRegion(stageId);
    await audit(u, "توزيع المجموعات حسب المنطقة", "Competition", s.competitionId, { stage: s.name, map });
    return `تم التوزيع حسب المنطقة — ${map.join(" | ")}`;
  });
}

export async function stageSaveGroups(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const map = new Map<number, string | null>();
    for (const clubId of ints(f, "team")) map.set(clubId, str(f, `g_${clubId}`));
    await setGroups(stageId, map);
    await audit(u, "توزيع المجموعات يدويًا", "Competition", s.competitionId, { stage: s.name });
    return "تم حفظ توزيع المجموعات";
  });
}

export async function stageQualify(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const per = int(f, "perGroup") ?? s.qualifyPerGroup ?? 2;
    const best = s.format === "GROUPS" ? int(f, "best") ?? s.qualifyBest ?? 0 : 0;
    const r = await qualifyToNext(stageId, per, best, (cid, sid) => standings(cid, sid));
    for (const t of await db.select().from(stageTeams).where(eq(stageTeams.stageId, r.next.id))) await notifyClub(t.clubId, "تأهل إلى المرحلة التالية", r.next.name, "/club/matches");
    await audit(u, "تأهيل فرق للمرحلة التالية", "Competition", s.competitionId, { from: s.name, to: r.next.name, count: r.count });
    return `تأهل ${r.count} فريق إلى «${r.next.name}»`;
  });
}

/** الإقران اليدوي لمواجهات الدور الأول في خروج المغلوب */
export async function stageManualPairs(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const pairs: [number, number][] = [];
    for (let i = 0; i < 64; i++) {
      const a = int(f, `a_${i}`), b = int(f, `b_${i}`);
      if (a && b) pairs.push([a, b]); else if (a || b) throw new UserError(`أكمل المواجهة رقم ${i + 1}`);
    }
    const n = await manualKoPairs(stageId, pairs);
    await audit(u, "إقران يدوي لخروج المغلوب", "Competition", s.competitionId, { stage: s.name, pairs });
    return `تم إنشاء ${pairs.length} مواجهة (${n} مباراة) — حدّد المواعيد من «الجدول والمباريات»`;
  });
}

export async function stageNextRound(f: FormData) {
  const u = await requireUser("comp.manage");
  const stageId = int(f, "stageId")!;
  const s = await getStage(stageId);
  await attempt(stageBack(s.competitionId, stageId), async () => {
    guard(await inScopeStage(u, stageId));
    const r = await nextKnockoutRound(stageId);
    if (r.champion) {
      const [cl] = await db.select({ n: clubs.name }).from(clubs).where(eq(clubs.id, r.champion));
      await audit(u, "حسم خروج المغلوب", "Competition", s.competitionId, { champion: cl?.n });
      return `🏆 البطل: ${cl?.n} — انتهت المرحلة`;
    }
    await audit(u, "إنشاء دور تالٍ", "Competition", s.competitionId, { stage: s.name, round: r.name });
    return `تم إنشاء ${r.name} (${r.created} مباراة) — حدّد المواعيد من «الجدول والمباريات»`;
  });
}

/** ركلات الترجيح لمباراة خروج مغلوب انتهت بالتعادل (أو مجموع متعادل) */
export async function setPenalties(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
    guard(await inScopeMatch(u, matchId));
    const hp = int(f, "homePens"), ap = int(f, "awayPens");
    if (hp != null && ap != null && hp === ap) throw new UserError("ركلات الترجيح لا تنتهي بالتعادل");
    await db.update(matches).set({ homePens: hp, awayPens: ap }).where(eq(matches.id, matchId));
    await audit(u, "إدخال ركلات الترجيح", "Match", matchId, { hp, ap });
    return hp == null ? "أُزيلت ركلات الترجيح" : `تم تسجيل ركلات الترجيح (${hp} - ${ap})`;
  });
}

export async function saveMatch(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id");
  const compId = int(f, "competitionId")!;
  await attempt(id ? `/matches/${id}` : `/competitions/${compId}?tab=fixtures`, async () => {
    guard(await inScopeComp(u, compId));
    if (id) guard(await inScopeMatch(u, id));
    guard((await inScopeClub(u, int(f, "homeClubId"))) && (await inScopeClub(u, int(f, "awayClubId"))));
    const home = int(f, "homeClubId")!, away = int(f, "awayClubId")!;
    if (home === away) throw new UserError("لا يمكن أن يلعب الفريق ضد نفسه");
    let late48 = "";
    const data = {
      competitionId: compId, round: int(f, "round") ?? 1, groupName: str(f, "groupName"), homeClubId: home, awayClubId: away,
      ...(f.has("stageId") ? { stageId: int(f, "stageId"), tieNo: int(f, "tieNo"), leg: int(f, "leg") } : {}),
      kickoff: fromLocalInput(str(f, "kickoff")), venue: str(f, "venue"), city: str(f, "city"),
      status: (str(f, "status") ?? "SCHEDULED") as "SCHEDULED", notes: str(f, "notes"),
    };
    const sd = await resolveStadium(data.venue);
    const block = stadiumBlock(sd, data.kickoff ? dayOf(data.kickoff) : null);
    if (block && data.status === "SCHEDULED") throw new UserError(await blockWithHint(block, home, data.kickoff ? dayOf(data.kickoff) : null));
    Object.assign(data, { stadiumId: sd?.id ?? null, city: data.city ?? sd?.city ?? null });
    if (id) {
      const [old] = await db.select().from(matches).where(eq(matches.id, id));
      // مباراة معتمدة النتيجة: لا يتغير طرفاها ولا مسابقتها ولا حالتها (يؤثر على الترتيب والإيقافات)
      if (old.reportStatus === "APPROVED" && (old.homeClubId !== home || old.awayClubId !== away || old.competitionId !== compId || old.status !== data.status))
        throw new UserError("المباراة معتمدة النتيجة — لا يمكن تغيير الفريقين أو المسابقة أو الحالة");
      await db.update(matches).set(data).where(eq(matches.id, id));
      if (old.kickoff?.getTime() !== data.kickoff?.getTime() && data.kickoff && data.kickoff.getTime() - Date.now() < 48 * 3600e3 && data.kickoff.getTime() > Date.now())
        late48 = " — ⚠ تنبيه: التعديل قبل أقل من 48 ساعة من الموعد (م48 تشترط إخطار الناديين قبل 48 ساعة إلا للضرورة القصوى)";
      if (old.kickoff?.getTime() !== data.kickoff?.getTime() || old.status !== data.status) {
        for (const c of [home, away]) await notifyClub(c, "تحديث موعد/حالة مباراة", `الجولة ${data.round}`, `/club/matches/${id}`);
        const as = await db.select().from(assignments).where(eq(assignments.matchId, id));
        for (const a of as) await notifyOfficial(a.officialId, "تحديث موعد مباراة معيّن فيها", null, `/portal/matches/${id}`);
      }
    } else {
      const st = await ensureStages(compId);
      const stageId = int(f, "stageId") ?? (st.find((x) => x.status !== "DONE") ?? st[st.length - 1]).id;
      await db.insert(matches).values({ ...data, stageId });
    }
    await audit(u, id ? "تعديل مباراة" : "إضافة مباراة", "Match", id, data);
    return "تم حفظ المباراة" + late48;
  });
}

/** تحديث مواعيد عدة مباريات دفعة واحدة من جدول المسابقة */
export async function bulkSchedule(f: FormData) {
  const u = await requireUser("comp.manage");
  const compId = int(f, "competitionId")!;
  await attempt(`/competitions/${compId}?tab=fixtures`, async () => {
    guard(await inScopeComp(u, compId));
    const ids = ints(f, "mid");
    let n = 0;
    for (const id of ids) {
      const k = fromLocalInput(str(f, `k_${id}`));
      const v = str(f, `v_${id}`);
      const sd = await resolveStadium(v);
      const block = stadiumBlock(sd, k ? dayOf(k) : null);
      if (block) {
        const [mm] = await db.select({ h: matches.homeClubId }).from(matches).where(eq(matches.id, id));
        throw new UserError(`مباراة #${id}: ${await blockWithHint(block, mm.h, k ? dayOf(k) : null)}`);
      }
      await db.update(matches).set({ kickoff: k, venue: v, stadiumId: sd?.id ?? null }).where(and(eq(matches.id, id), eq(matches.competitionId, compId)));
      n++;
    }
    await audit(u, "جدولة مواعيد", "Competition", compId, { n });
    return `تم تحديث ${n} مباراة`;
  });
}

export async function deleteMatch(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  await attempt(`/competitions/${m?.competitionId}?tab=fixtures`, async () => {
    guard(await inScopeMatch(u, id));
    if (m.reportStatus !== "NONE") throw new UserError("للمباراة تقرير — لا يمكن حذفها");
    await db.delete(matches).where(eq(matches.id, id));
    await audit(u, "حذف مباراة", "Match", id);
    return "تم الحذف";
  });
}

export async function committeeLineup(f: FormData) {
  const u = await requireUser("comp.lineups");
  const matchId = int(f, "matchId")!, clubId = int(f, "clubId")!;
  await attempt(`/matches/${matchId}?tab=lineups`, async () => {
    guard(await inScopeMatch(u, matchId));
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد — لا يمكن تعديل القائمة");
    await saveLineup(matchId, clubId, f);
    await audit(u, "إدخال قائمة مباراة (اللجنة)", "Match", matchId, { clubId });
    return "تم حفظ القائمة";
  });
}

export async function addEvent(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
    guard(await inScopeMatch(u, matchId));
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد");
    let clubId = int(f, "clubId")!;
    const type = str(f, "type") as "GOAL" | "SUB_IN";
    // بطاقة لمرافق (جهاز فني أو إداري): من الجهاز المسجّل أو بالاسم
    const staffId = int(f, "staffId"), staffName = str(f, "staffName"), staffRole = str(f, "staffRole");
    if (staffId || staffName) {
      if (!["YELLOW", "SECOND_YELLOW", "RED"].includes(type)) throw new UserError("أحداث المرافقين: بطاقات الإنذار والطرد فقط");
      if (int(f, "playerId")) throw new UserError("اختر اللاعب أو المرافق، لا الاثنين");
      if (staffId) {
        const [st] = await db.select({ c: staff.clubId }).from(staff).where(eq(staff.id, staffId));
        if (!st) throw new UserError("المرافق غير موجود");
        clubId = st.c;
      }
      if (clubId !== m.homeClubId && clubId !== m.awayClubId) throw new UserError("المرافق ليس من فريقي المباراة");
      await db.insert(matchEvents).values({ matchId, clubId, staffId, staffName: staffId ? null : staffName, staffRole, type, minute: int(f, "minute"), note: str(f, "note") });
      await audit(u, "إضافة بطاقة مرافق", "Match", matchId);
      return "تمت الإضافة";
    }
    const playerId = int(f, "playerId");
    // عند اختيار لاعب من القائمة يُؤخذ فريقه من القائمة نفسها (يمنع تسجيل الحدث للفريق الخطأ)
    if (playerId) {
      const [own] = await db.select({ c: matchSquads.clubId }).from(matchSquads).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.playerId, playerId)));
      if (own) clubId = own.c;
    }
    if (clubId !== m.homeClubId && clubId !== m.awayClubId) throw new UserError("النادي غير صحيح");
    if (playerId) {
      // اللاعب يجب أن يكون من قائمة النادي في المباراة، أو مقيدًا لديه إن لم تُدخل القائمة
      const [sq] = await db.select({ id: matchSquads.id }).from(matchSquads).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.clubId, clubId), eq(matchSquads.playerId, playerId)));
      if (!sq) {
        const [anySq] = await db.select({ id: matchSquads.id }).from(matchSquads).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.clubId, clubId))).limit(1);
        const [c] = await db.select({ s: competitions.seasonId }).from(competitions).where(eq(competitions.id, m.competitionId));
        const [rg] = anySq ? [] : await db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.playerId, playerId), eq(registrations.clubId, clubId), eq(registrations.seasonId, c.s), eq(registrations.status, "APPROVED")));
        if (!rg) throw new UserError(anySq ? "اللاعب ليس في قائمة هذا النادي في المباراة" : "اللاعب غير مقيد لدى هذا النادي");
      }
    }
    if (type === "SUB_IN") await subsLimitCheck(matchId, clubId, int(f, "minute"));
    if (type === "SUB_IN" && playerId) await foreignOnPitchCheck(matchId, clubId, playerId);
    await db.insert(matchEvents).values({ matchId, clubId, playerId, type, minute: int(f, "minute"), note: str(f, "note") });
    await audit(u, "إضافة حدث مباراة", "Match", matchId);
    return "تمت الإضافة";
  });
}

export async function deleteEvent(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
    guard(await inScopeMatch(u, matchId));
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد");
    await db.delete(matchEvents).where(and(eq(matchEvents.id, int(f, "eventId")!), eq(matchEvents.matchId, matchId)));
    await audit(u, "حذف حدث مباراة", "Match", matchId);
    return "تم الحذف";
  });
}

export async function setResult(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
    guard(await inScopeMatch(u, matchId));
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد");
    const hs = int(f, "homeScore"), as_ = int(f, "awayScore"), att = int(f, "attendance");
    if ((hs != null && hs < 0) || (as_ != null && as_ < 0) || (att != null && att < 0)) throw new UserError("القيم لا تكون سالبة");
    await db.update(matches).set({ homeScore: hs, awayScore: as_, attendance: att }).where(eq(matches.id, matchId));
    await audit(u, "إدخال نتيجة", "Match", matchId);
    return "تم حفظ النتيجة";
  });
}

export async function approveReport(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
    guard(await inScopeMatch(u, matchId));
    let res = { home: 0, away: 0, suspensions: 0 };
    await db.transaction(async (tx) => {
      res = await approveMatch(tx, matchId, u.fullName);
      await audit(u, "اعتماد تقرير مباراة", "Match", matchId, res, tx);
    });
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    for (const c of [m.homeClubId, m.awayClubId]) await notifyClub(c, "اعتُمدت نتيجة مباراة", `${res.home} - ${res.away}`, `/club/matches/${matchId}`);
    return `تم اعتماد التقرير (${res.home} - ${res.away})${res.suspensions ? ` — ${res.suspensions} إيقاف تلقائي` : ""}`;
  });
}

export async function returnReport(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
    guard(await inScopeMatch(u, matchId));
    const reason = req(f, "reason", "سبب الإعادة");
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus !== "SUBMITTED") throw new UserError("لا يوجد تقرير مرسل");
    await db.update(matches).set({ reportStatus: "RETURNED", reportReturn: reason }).where(eq(matches.id, matchId));
    const [ref] = await db.select().from(assignments).where(and(eq(assignments.matchId, matchId), eq(assignments.role, "REFEREE")));
    if (ref) await notifyOfficial(ref.officialId, "أُعيد تقرير المباراة للتصحيح", reason, `/portal/matches/${matchId}`);
    await audit(u, "إعادة تقرير للحكم", "Match", matchId, reason);
    return "أُعيد التقرير للحكم";
  });
}

export async function decideMatchRequest(f: FormData) {
  const u = await requireUser("comp.requests");
  await attempt("/competitions/requests", async () => {
    const id = int(f, "id")!;
    const ok = f.get("decision") === "approve";
    const decision = str(f, "decision_text");
    const [r] = await db.select().from(matchRequests).where(eq(matchRequests.id, id));
    if (!r || r.status !== "PENDING") throw new UserError("الطلب غير متاح");
    guard(await inScopeMatch(u, r.matchId));
    if (!ok && !decision) throw new UserError("اكتب سبب الرفض");
    const newDate = fromLocalInput(str(f, "newDate"));
    await db.transaction(async (tx) => {
      await tx.update(matchRequests).set({ status: ok ? "APPROVED" : "REJECTED", decision, decidedBy: u.fullName }).where(eq(matchRequests.id, id));
      if (ok) await tx.update(matches).set({ status: newDate ? "SCHEDULED" : "POSTPONED", kickoff: newDate ?? undefined }).where(eq(matches.id, r.matchId));
    });
    const [m] = await db.select().from(matches).where(eq(matches.id, r.matchId));
    for (const c of [m.homeClubId, m.awayClubId]) await notifyClub(c, ok ? "تأجيل مباراة" : "رُفض طلب التأجيل", decision, `/club/matches/${m.id}`);
    if (ok) for (const a of await db.select().from(assignments).where(eq(assignments.matchId, m.id))) await notifyOfficial(a.officialId, "تأجيل مباراة معيّن فيها", decision, `/portal/matches/${m.id}`);
    await audit(u, ok ? "قبول تأجيل مباراة" : "رفض تأجيل مباراة", "Match", r.matchId, decision);
    return ok ? "تم تأجيل المباراة وإبلاغ الأندية والطاقم" : "تم رفض الطلب";
  });
}

/** قائمة الموسم للمسابقة (يحددها النادي أو اللجنة) */
export async function saveSquadList(f: FormData) {
  const u = await requireUser("club.lineups", "comp.lineups");
  const competitionId = int(f, "competitionId")!;
  const clubId = u.isClub ? u.clubId! : int(f, "clubId")!;
  const back = u.isClub ? `/club/competitions/${competitionId}` : `/competitions/${competitionId}?tab=squads&club=${clubId}`;
  await attempt(back, async () => {
    if (!u.isClub) guard((await inScopeComp(u, competitionId)) && (await inScopeClub(u, clubId)));
    const [c] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
    if (c.squadListMax == null) throw new UserError("هذه المسابقة لا تتطلب قائمة موسم");
    const [team] = await db.select({ id: competitionTeams.id }).from(competitionTeams).where(and(eq(competitionTeams.competitionId, competitionId), eq(competitionTeams.clubId, clubId)));
    if (!team) throw new UserError("النادي ليس من فرق هذه المسابقة");
    const ids = ints(f, "player");
    if (ids.length > c.squadListMax) throw new UserError(`الحد الأقصى لقائمة الموسم ${c.squadListMax} لاعبًا`);
    const valid = await db.select({ pid: registrations.playerId }).from(registrations)
      .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, c.seasonId), eq(registrations.status, "APPROVED")));
    const ok = new Set(valid.map((v) => v.pid));
    if (ids.some((x) => !ok.has(x))) throw new UserError("لاعب غير مقيد لدى النادي في موسم المسابقة");
    await db.transaction(async (tx) => {
      await tx.delete(competitionSquads).where(and(eq(competitionSquads.competitionId, competitionId), eq(competitionSquads.clubId, clubId)));
      if (ids.length) await tx.insert(competitionSquads).values(ids.map((playerId) => ({ competitionId, clubId, playerId })));
    });
    const [cl] = await db.select({ n: clubs.name }).from(clubs).where(eq(clubs.id, clubId));
    await audit(u, "حفظ قائمة الموسم", "Competition", competitionId, { club: cl?.n, count: ids.length });
    return `تم حفظ قائمة الموسم (${ids.length} لاعب)`;
  });
}

export async function saveRestHours(f: FormData) {
  const u = await requireUser("comp.manage");
  await attempt("/competitions/calendar", async () => {
    guard(!u.divisionId);
    const v = String(Math.max(12, int(f, "hours") ?? 48));
    await db.insert(settings).values({ key: "min_rest_hours", value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
    await audit(u, "تعديل الحد الأدنى للراحة", "Setting", null, v);
    return "تم الحفظ";
  });
}

/** حذف المسابقة نهائيًا مع كل ما نتج عنها — لمدير المنظومة فقط، بعد كتابة اسم المسابقة للتأكيد */
export async function deleteCompetition(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  let done = false;
  await attempt(() => (done ? "/competitions" : `/competitions/${id}?tab=settings`), async () => {
    if (u.role !== "ADMIN") throw new UserError("حذف المسابقة نهائيًا من صلاحية مدير المنظومة فقط");
    const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
    if (!c) throw new UserError("المسابقة غير موجودة");
    if ((str(f, "confirm") ?? "").replace(/\s+/g, " ").trim() !== c.name.replace(/\s+/g, " ").trim()) throw new UserError("اكتب اسم المسابقة كما هو تمامًا للتأكيد");
    let counts;
    try { counts = await deleteCompetitionCascade(id); }
    catch (e) { if (e instanceof Error && e.message.startsWith("PAYMENTS:")) throw new UserError(`توجد ${e.message.split(":")[1]} دفعة مالية مسجلة على مستحقات هذه المسابقة — ألغِ الدفعات من المالية أولًا`); throw e; }
    await audit(u, "حذف مسابقة نهائيًا", "Competition", id, { name: c.name, ...counts });
    done = true;
    return `حُذفت المسابقة «${c.name}» نهائيًا مع ${counts.matches} مباراة و${counts.sanctions} عقوبة و${counts.charges} مستحقًا ماليًا`;
  });
}
