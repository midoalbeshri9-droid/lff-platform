import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, clubs, competitions, competitionStages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { inScopeComp } from "@/lib/scope";

/** تصدير جدول مباريات مسابقة بملف CSV للاستيراد في FIFA FCMS («How to Import a Fixture»)
 *  الأعمدة: المسابقة، المرحلة، الجولة، التاريخ (dd/mm/yyyy)، الوقت (HH:mm)، الفريق المضيف، الفريق الضيف، الملعب.
 *  ملاحظة: يجب أن تطابق أسماء الفرق أسماءها في FCMS (يُستخدم الاسم الإنجليزي للنادي إن وُجد) — راجع قالب FCMS قبل الاستيراد */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  const id = Number(new URL(req.url).searchParams.get("competition"));
  if (!u || !u.can("comp.view") || !id || !(await inScopeComp(u, id))) return new Response("غير مصرح", { status: 403 });
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!c) return new Response("غير موجود", { status: 404 });
  const ms = await db.select().from(matches).where(eq(matches.competitionId, id)).orderBy(asc(matches.round), asc(matches.kickoff));
  const st = await db.select().from(competitionStages).where(eq(competitionStages.competitionId, id));
  const ids = [...new Set(ms.flatMap((m) => [m.homeClubId, m.awayClubId]))];
  const cl = ids.length ? await db.select({ id: clubs.id, name: clubs.name, en: clubs.nameEn }).from(clubs).where(inArray(clubs.id, ids)) : [];
  const team = (cid: number) => { const x = cl.find((y) => y.id === cid); return x?.en || x?.name || ""; };
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const tz = { timeZone: "Africa/Tripoli" } as const;
  const rows = [["Competition", "Stage", "Round", "Date", "Time", "Home Team", "Away Team", "Venue"]];
  for (const m of ms) {
    const k = m.kickoff ? new Date(m.kickoff) : null;
    rows.push([
      c.name, st.find((s) => s.id === m.stageId)?.name ?? "", String(m.round ?? ""),
      k ? k.toLocaleDateString("en-GB", tz) : "", k ? k.toLocaleTimeString("en-GB", { ...tz, hour: "2-digit", minute: "2-digit" }) : "",
      team(m.homeClubId), team(m.awayClubId), m.venue ?? "",
    ]);
  }
  const csv = "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`FCMS-fixtures-${c.name}.csv`)}` } });
}
