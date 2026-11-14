import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  players, registrations, suspensions, matchSquads, matchEvents, contracts, sanctions, competitionSquads, correspondence, archiveDocs, passportRecords,
} from "@/db/schema";
import { normName } from "./fifaid";
import { UserError } from "./util";

/** المرشحون للتكرار: نفس الاسم (بعد التوحيد) ونفس تاريخ الميلاد */
export async function duplicateGroups(limit = 300) {
  const rows = await db.select({ id: players.id, name: players.fullName, dob: players.dateOfBirth, card: players.cardNo, nid: players.nationalId, fifa: players.fifaId }).from(players);
  const g = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.dob) continue;
    const k = `${normName(r.name)}|${r.dob}`;
    g.set(k, [...(g.get(k) ?? []), r]);
  }
  return [...g.values()].filter((x) => x.length > 1).slice(0, limit);
}

/** ما سيُنقل من السجل المكرر */
export async function mergeCounts(dupId: number) {
  const c = async (t: typeof registrations | typeof suspensions | typeof matchSquads | typeof matchEvents | typeof contracts | typeof sanctions | typeof competitionSquads | typeof correspondence | typeof archiveDocs | typeof passportRecords) =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(t as typeof registrations).where(eq((t as typeof registrations).playerId, dupId)))[0]?.n ?? 0);
  return {
    registrations: await c(registrations), suspensions: await c(suspensions), matchEvents: await c(matchEvents), matchSquads: await c(matchSquads),
    contracts: await c(contracts), sanctions: await c(sanctions), competitionSquads: await c(competitionSquads), correspondence: await c(correspondence),
    archiveDocs: await c(archiveDocs), passportRecords: await c(passportRecords),
  };
}

/** دمج سجل لاعب مكرر في السجل الرئيسي — لا يمكن التراجع عنه (كما في FIFA Connect) */
export async function mergePlayers(masterId: number, dupId: number, by: string) {
  if (masterId === dupId) throw new UserError("اختر سجلين مختلفين");
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(players).where(eq(players.id, masterId));
    const [d] = await tx.select().from(players).where(eq(players.id, dupId));
    if (!m || !d) throw new UserError("أحد السجلين غير موجود");
    // التشكيلات: إن وُجد اللاعبان في نفس المباراة/المسابقة يُحذف سطر المكرر
    await tx.execute(sql`delete from match_squads s where s.player_id = ${dupId} and exists (select 1 from match_squads x where x.match_id = s.match_id and x.player_id = ${masterId})`);
    await tx.execute(sql`delete from competition_squads s where s.player_id = ${dupId} and exists (select 1 from competition_squads x where x.competition_id = s.competition_id and x.player_id = ${masterId})`);
    for (const t of [registrations, suspensions, matchSquads, matchEvents, contracts, sanctions, competitionSquads, correspondence, archiveDocs, passportRecords])
      await tx.update(t).set({ playerId: masterId } as never).where(eq(t.playerId, dupId));
    // الحقول الفارغة في الرئيسي تُكمَّل من المكرر (الحقول الفريدة تُفرّغ من المكرر أولًا)
    const fill: Record<string, unknown> = {};
    const keys = ["fullNameEn", "motherName", "nationalId", "cardNo", "passportNo", "fifaId", "placeOfBirth", "address", "phone", "photoKey", "dateOfBirth"] as const;
    for (const k of keys) if (!(m as Record<string, unknown>)[k] && (d as Record<string, unknown>)[k]) fill[k] = (d as Record<string, unknown>)[k];
    const snapshot = JSON.stringify({ id: d.id, fullName: d.fullName, cardNo: d.cardNo, nationalId: d.nationalId, fifaId: d.fifaId, dateOfBirth: d.dateOfBirth });
    await tx.update(players).set({ nationalId: null, cardNo: null, fifaId: null } as never).where(eq(players.id, dupId));
    await tx.update(players).set({ ...fill, notes: [m.notes, `دُمج فيه السجل المكرر #${d.id} (${d.fullName}) بواسطة ${by}`].filter(Boolean).join("\n") } as never).where(eq(players.id, masterId));
    await tx.delete(players).where(eq(players.id, dupId));
    return { snapshot, filled: Object.keys(fill) };
  });
}
