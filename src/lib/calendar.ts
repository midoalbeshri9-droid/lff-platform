import "server-only";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, clubs, competitions, stadiums, assignments, officials, settings } from "@/db/schema";
import { stadiumBlock } from "./stadiums";

export type CalMatch = { id: number; kickoff: Date | null; home: string; away: string; homeId: number; awayId: number; comp: string; compId: number; venue: string | null; status: string; stadiumId: number | null };
export type Conflict = { kind: "REST" | "STADIUM" | "STADIUM_STATUS" | "REFEREE"; matchIds: number[]; text: string; day: string };

const dayOf = (d: Date) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10); // توقيت ليبيا

/** مباريات فترة زمنية (مع التي بلا موعد إن طُلبت) */
export async function calendarMatches(from: Date, to: Date, f: { compId?: number; clubId?: number } = {}) {
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const rows = await db.select({ m: matches, home: h.name, away: a.name, comp: competitions.name }).from(matches)
    .innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(gte(matches.kickoff, from), lte(matches.kickoff, to), ne(matches.status, "CANCELLED"), f.compId ? eq(matches.competitionId, f.compId) : undefined))
    .orderBy(matches.kickoff);
  return rows
    .filter((r) => !f.clubId || r.m.homeClubId === f.clubId || r.m.awayClubId === f.clubId)
    .map((r): CalMatch => ({ id: r.m.id, kickoff: r.m.kickoff, home: r.home, away: r.away, homeId: r.m.homeClubId, awayId: r.m.awayClubId, comp: r.comp, compId: r.m.competitionId, venue: r.m.venue, status: r.m.status, stadiumId: r.m.stadiumId }));
}

/**
 * كشف التعارضات:
 * - نادٍ يلعب مباراتين بفاصل أقل من الحد الأدنى للراحة (الإعداد min_rest_hours، افتراضي 48 ساعة)
 * - ملعب عليه مباراتان في اليوم نفسه بفاصل أقل من 3 ساعات
 * - مباراة على ملعب موقوف أو مغلق أو منتهي الاعتماد
 * - حكم/مراقب معيّن في مباراتين في اليوم نفسه
 */
export async function findConflicts(from: Date, to: Date) {
  // نوسّع الفترة يومين لالتقاط تعارضات الحدود
  const ms = await calendarMatches(new Date(from.getTime() - 3 * 864e5), new Date(to.getTime() + 3 * 864e5));
  const [cfg] = await db.select().from(settings).where(eq(settings.key, "min_rest_hours"));
  const rest = Number(cfg?.value ?? 48);
  const out: Conflict[] = [];
  const inRange = (d: Date) => d >= from && d <= to;

  // 1) راحة النادي
  const clubIds = [...new Set(ms.flatMap((m) => [m.homeId, m.awayId]))];
  const names = new Map(ms.flatMap((m) => [[m.homeId, m.home], [m.awayId, m.away]] as [number, string][]));
  for (const c of clubIds) {
    const list = ms.filter((m) => m.kickoff && (m.homeId === c || m.awayId === c)).sort((x, y) => x.kickoff!.getTime() - y.kickoff!.getTime());
    for (let i = 1; i < list.length; i++) {
      const gap = (list[i].kickoff!.getTime() - list[i - 1].kickoff!.getTime()) / 3600e3;
      if (gap < rest && (inRange(list[i].kickoff!) || inRange(list[i - 1].kickoff!)))
        out.push({ kind: "REST", matchIds: [list[i - 1].id, list[i].id], day: dayOf(list[i].kickoff!), text: `${names.get(c)} يلعب مباراتين بفاصل ${Math.round(gap)} ساعة (الحد الأدنى ${rest})` });
    }
  }
  // 2) الملعب نفسه
  const key = (m: CalMatch) => (m.stadiumId ? `id:${m.stadiumId}` : m.venue?.trim() ? `v:${m.venue.trim()}` : null);
  const byVenue = new Map<string, CalMatch[]>();
  for (const m of ms) { const k = key(m); if (k && m.kickoff) byVenue.set(k, [...(byVenue.get(k) ?? []), m]); }
  for (const list of byVenue.values()) {
    list.sort((x, y) => x.kickoff!.getTime() - y.kickoff!.getTime());
    for (let i = 1; i < list.length; i++) {
      const gap = (list[i].kickoff!.getTime() - list[i - 1].kickoff!.getTime()) / 3600e3;
      if (gap < 3 && inRange(list[i].kickoff!))
        out.push({ kind: "STADIUM", matchIds: [list[i - 1].id, list[i].id], day: dayOf(list[i].kickoff!), text: `الملعب «${list[i].venue}» محجوز لمباراتين بفاصل ${gap.toFixed(1)} ساعة` });
    }
  }
  // 3) حالة الملعب
  const sids = [...new Set(ms.map((m) => m.stadiumId).filter(Boolean))] as number[];
  const st = sids.length ? await db.select().from(stadiums).where(inArray(stadiums.id, sids)) : [];
  for (const m of ms) {
    if (!m.kickoff || !m.stadiumId || m.status !== "SCHEDULED" || !inRange(m.kickoff)) continue;
    const b = stadiumBlock(st.find((x) => x.id === m.stadiumId), dayOf(m.kickoff));
    if (b) out.push({ kind: "STADIUM_STATUS", matchIds: [m.id], day: dayOf(m.kickoff), text: `${m.home} × ${m.away}: ${b}` });
  }
  // 4) الحكام
  const ids = ms.map((m) => m.id);
  if (ids.length) {
    const as = await db.select({ a: assignments, name: officials.fullName }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId))
      .where(and(inArray(assignments.matchId, ids), ne(assignments.status, "DECLINED")));
    const byOff = new Map<number, typeof as>();
    for (const x of as) byOff.set(x.a.officialId, [...(byOff.get(x.a.officialId) ?? []), x]);
    for (const list of byOff.values()) {
      const days = new Map<string, number[]>();
      for (const x of list) {
        const m = ms.find((k) => k.id === x.a.matchId);
        if (!m?.kickoff || !inRange(m.kickoff)) continue;
        const d = dayOf(m.kickoff);
        days.set(d, [...(days.get(d) ?? []), m.id]);
      }
      for (const [d, mids] of days) if (new Set(mids).size > 1) out.push({ kind: "REFEREE", matchIds: [...new Set(mids)], day: d, text: `${list[0].name} معيّن في ${new Set(mids).size} مباريات في اليوم نفسه` });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
