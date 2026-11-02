import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sanctions, clubs, players, staff, competitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { SANCTION_TYPE, SANCTION_TARGET } from "@/lib/labels";
import { fmtDate, money } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

export default async function PrintSanction({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const id = Number((await params).id);
  const [row] = await db.select({ s: sanctions, club: clubs.name, player: players.fullName, staffName: staff.fullName, comp: competitions.name })
    .from(sanctions).innerJoin(clubs, eq(clubs.id, sanctions.clubId)).leftJoin(players, eq(players.id, sanctions.playerId))
    .leftJoin(staff, eq(staff.id, sanctions.staffId)).leftJoin(competitions, eq(competitions.id, sanctions.competitionId)).where(eq(sanctions.id, id));
  if (!row) notFound();
  if (!(u.canAny("comp.view", "comp.sanctions") || (u.isClub && u.clubId === row.s.clubId))) redirect("/denied");
  const s = row.s;
  const who = s.targetType === "CLUB" ? `نادي ${row.club}` : `${SANCTION_TARGET[s.targetType]}: ${row.player ?? row.staffName} — نادي ${row.club}`;
  return (
    <div className="print-root">
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet">
        <Letterhead sub="لجنة المسابقات" subEn="Competitions Committee" />
        <div className="meta-line"><span>رقم القرار: <strong>{s.number}</strong></span><span>التاريخ: {fmtDate(s.decisionDate)}</span></div>
        <h1 className="doc-title">قرار</h1>
        <div className="body">
          {`إن لجنة المسابقات بالاتحاد الليبي لكرة القدم،
بعد الاطلاع على ${s.articleText ?? "اللوائح المنظمة"}${row.comp ? `، وعلى ما ورد بشأن ${row.comp}` : ""}،
وعلى الوقائع التالية:
${s.reason}

قررت:
أولًا: معاقبة ${who} بـ: ${SANCTION_TYPE[s.type]}${s.matchesCount ? ` لمدة (${s.matchesCount}) مباراة` : ""}${s.toDate ? ` اعتبارًا من ${fmtDate(s.fromDate)} وحتى ${fmtDate(s.toDate)}` : ""}${s.points ? ` بواقع (${s.points}) نقطة` : ""}.
${Number(s.fineAmount) > 0 ? `ثانيًا: تغريم ${s.targetType === "CLUB" ? "النادي" : "المعاقَب"} مبلغًا قدره ${money(s.fineAmount)} تُسدد لدى اللجنة المالية.\n` : ""}${Number(s.fineAmount) > 0 ? "ثالثًا" : "ثانيًا"}: يحق للمعني الطعن في هذا القرار خلال المهلة المحددة حتى ${fmtDate(s.appealDeadline)}.
${Number(s.fineAmount) > 0 ? "رابعًا" : "ثالثًا"}: يُبلّغ هذا القرار لمن يلزم لتنفيذه.`}
        </div>
        <div className="signatures"><div className="sig">مقرر اللجنة</div><div className="sig">رئيس لجنة المسابقات</div></div>
      </div>
    </div>
  );
}
