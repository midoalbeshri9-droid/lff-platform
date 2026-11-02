import { redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, clubs, competitions } from "@/db/schema";
import { ensureStages } from "@/lib/stages";
import { getCurrentUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

export default async function Fixtures({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u?.can("comp.view")) redirect("/denied");
  const id = Number((await params).id);
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const ms = await db.select({ m: matches, home: h.name, away: a.name }).from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .where(eq(matches.competitionId, id)).orderBy(asc(matches.round), asc(matches.tieNo), asc(matches.leg), asc(matches.kickoff));
  const stages = await ensureStages(id);
  const blocks = stages.flatMap((st) => {
    const sm = ms.filter((x) => x.m.stageId === st.id);
    return [...new Set(sm.map((x) => x.m.round))].map((r) => ({
      key: `${st.id}-${r}`, title: `${stages.length > 1 ? st.name + " — " : ""}${st.format === "KNOCKOUT" ? "الدور" : "الجولة"} ${r}`, rows: sm.filter((x) => x.m.round === r),
    }));
  });
  return (
    <div className="print-root">
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet">
        <Letterhead sub="لجنة المسابقات" subEn="Competitions Committee" />
        <h1 className="doc-title">جدول مباريات {c?.name}</h1>
        {blocks.map((b) => (
          <table key={b.key} className="roster-table" style={{ marginBottom: 10 }}>
            <thead><tr><th colSpan={4}>{b.title}</th></tr></thead>
            <tbody>{b.rows.map(({ m, home, away }) => (
              <tr key={m.id}><td className="l">{home}{m.groupName ? ` (${m.groupName})` : ""}</td><td>{m.homeScore != null ? `${m.homeScore} - ${m.awayScore}${m.homePens != null ? ` (ت ${m.homePens}-${m.awayPens})` : ""}` : "×"}</td><td className="l">{away}</td><td>{fmtDateTime(m.kickoff)} — {m.venue}</td></tr>
            ))}</tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
