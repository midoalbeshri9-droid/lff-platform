"use server";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionTeams, matches, matchEvents, assignments, matchRequests, competitionSquads, registrations, clubs } from "@/db/schema";
import { addCharge } from "@/lib/finance";
import { foreignOnPitchCheck } from "@/lib/competition";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub, notifyOfficial } from "@/lib/audit";
import { generateFixtures, approveMatch } from "@/lib/competition";
import { saveLineup } from "@/lib/lineup";
import { attempt, str, req, int, ints, num, UserError, fromLocalInput } from "@/lib/util";

export async function saveCompetition(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id");
  await attempt(id ? `/competitions/${id}?tab=settings` : "/competitions", async () => {
    const data = {
      seasonId: int(f, "seasonId")!, name: req(f, "name", "اسم المسابقة"), type: (str(f, "type") ?? "LEAGUE") as "LEAGUE",
      categoryId: int(f, "categoryId"), legs: int(f, "legs") ?? 2, pointsWin: int(f, "pointsWin") ?? 3, pointsDraw: int(f, "pointsDraw") ?? 1,
      squadMax: int(f, "squadMax") ?? 20, startersCount: int(f, "startersCount") ?? 11, maxForeign: int(f, "maxForeign"),
      maxForeignOnPitch: int(f, "maxForeignOnPitch"), squadListMax: int(f, "squadListMax"), yellowRules: str(f, "yellowRules"), entryFee: num(f, "entryFee"),
      yellowThreshold: int(f, "yellowThreshold") ?? 3, redBanMatches: int(f, "redBanMatches") ?? 1, startDate: str(f, "startDate"), notes: str(f, "notes"),
    };
    if (id) await db.update(competitions).set(data).where(eq(competitions.id, id));
    else await db.insert(competitions).values(data);
    await audit(u, id ? "تعديل مسابقة" : "إنشاء مسابقة", "Competition", id, data.name);
    return "تم حفظ المسابقة";
  });
}

export async function setCompetitionStatus(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}`, async () => {
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
    const clubIds = ints(f, "club");
    if (!clubIds.length) throw new UserError("اختر ناديًا واحدًا على الأقل");
    const group = str(f, "groupName");
    const added = await db.insert(competitionTeams).values(clubIds.map((clubId) => ({ competitionId: id, clubId, groupName: group }))).onConflictDoNothing().returning();
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
    const clubId = int(f, "clubId")!;
    const [m] = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.competitionId, id), or(eq(matches.homeClubId, clubId), eq(matches.awayClubId, clubId)))).limit(1);
    if (m) throw new UserError("للفريق مباريات مجدولة — احذف الجدول أولًا");
    await db.delete(competitionTeams).where(and(eq(competitionTeams.competitionId, id), eq(competitionTeams.clubId, clubId)));
    await audit(u, "حذف فريق من مسابقة", "Competition", id, clubId);
    return "تم الحذف";
  });
}

export async function makeFixtures(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}?tab=fixtures`, async () => {
    const n = await generateFixtures(id);
    await audit(u, "إنشاء جدول المباريات", "Competition", id, { matches: n });
    return `تم إنشاء ${n} مباراة — حدّد مواعيدها من صفحة كل مباراة أو بالجدول`;
  });
}

export async function clearFixtures(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id")!;
  await attempt(`/competitions/${id}?tab=fixtures`, async () => {
    const played = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.competitionId, id), ne(matches.reportStatus, "NONE"))).limit(1);
    if (played.length) throw new UserError("توجد مباريات لها تقارير — لا يمكن حذف الجدول");
    await db.delete(matches).where(eq(matches.competitionId, id));
    await audit(u, "حذف جدول المباريات", "Competition", id);
    return "تم حذف الجدول";
  });
}

export async function saveMatch(f: FormData) {
  const u = await requireUser("comp.manage");
  const id = int(f, "id");
  const compId = int(f, "competitionId")!;
  await attempt(id ? `/matches/${id}` : `/competitions/${compId}?tab=fixtures`, async () => {
    const home = int(f, "homeClubId")!, away = int(f, "awayClubId")!;
    if (home === away) throw new UserError("لا يمكن أن يلعب الفريق ضد نفسه");
    const data = {
      competitionId: compId, round: int(f, "round") ?? 1, groupName: str(f, "groupName"), homeClubId: home, awayClubId: away,
      kickoff: fromLocalInput(str(f, "kickoff")), venue: str(f, "venue"), city: str(f, "city"),
      status: (str(f, "status") ?? "SCHEDULED") as "SCHEDULED", notes: str(f, "notes"),
    };
    if (id) {
      const [old] = await db.select().from(matches).where(eq(matches.id, id));
      await db.update(matches).set(data).where(eq(matches.id, id));
      if (old.kickoff?.getTime() !== data.kickoff?.getTime() || old.status !== data.status) {
        for (const c of [home, away]) await notifyClub(c, "تحديث موعد/حالة مباراة", `الجولة ${data.round}`, `/club/matches/${id}`);
        const as = await db.select().from(assignments).where(eq(assignments.matchId, id));
        for (const a of as) await notifyOfficial(a.officialId, "تحديث موعد مباراة معيّن فيها", null, `/portal/matches/${id}`);
      }
    } else await db.insert(matches).values(data);
    await audit(u, id ? "تعديل مباراة" : "إضافة مباراة", "Match", id, data);
    return "تم حفظ المباراة";
  });
}

/** تحديث مواعيد عدة مباريات دفعة واحدة من جدول المسابقة */
export async function bulkSchedule(f: FormData) {
  const u = await requireUser("comp.manage");
  const compId = int(f, "competitionId")!;
  await attempt(`/competitions/${compId}?tab=fixtures`, async () => {
    const ids = ints(f, "mid");
    let n = 0;
    for (const id of ids) {
      const k = fromLocalInput(str(f, `k_${id}`));
      const v = str(f, `v_${id}`);
      await db.update(matches).set({ kickoff: k, venue: v }).where(and(eq(matches.id, id), eq(matches.competitionId, compId)));
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
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد");
    const clubId = int(f, "clubId")!;
    if (clubId !== m.homeClubId && clubId !== m.awayClubId) throw new UserError("النادي غير صحيح");
    const type = str(f, "type") as "GOAL" | "SUB_IN", playerId = int(f, "playerId");
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
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد");
    await db.update(matches).set({ homeScore: int(f, "homeScore"), awayScore: int(f, "awayScore"), attendance: int(f, "attendance") }).where(eq(matches.id, matchId));
    await audit(u, "إدخال نتيجة", "Match", matchId);
    return "تم حفظ النتيجة";
  });
}

export async function approveReport(f: FormData) {
  const u = await requireUser("comp.reports");
  const matchId = int(f, "matchId")!;
  await attempt(`/matches/${matchId}?tab=report`, async () => {
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
    const [c] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
    if (c.squadListMax == null) throw new UserError("هذه المسابقة لا تتطلب قائمة موسم");
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
