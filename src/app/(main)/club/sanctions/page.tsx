import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { sanctions, players, staff, appeals } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { SANCTION_TYPE, SANCTION_TARGET, SANCTION_STATUS, APPEAL_STATUS } from "@/lib/labels";
import { fmtDate, money, today } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { submitAppeal } from "../../competitions/sanctions/actions";

export default async function ClubSanctions({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const rows = await db.select({ s: sanctions, player: players.fullName, staffName: staff.fullName }).from(sanctions)
    .leftJoin(players, eq(players.id, sanctions.playerId)).leftJoin(staff, eq(staff.id, sanctions.staffId))
    .where(eq(sanctions.clubId, u.clubId)).orderBy(desc(sanctions.id));
  const aps = await db.select().from(appeals).where(eq(appeals.clubId, u.clubId));
  const t = today();
  return (
    <>
      <PageHead title="العقوبات والقرارات" sub="القرارات الصادرة بحق النادي ولاعبيه وإدارييه — مع إمكانية الطعن خلال المهلة" />
      <Flash sp={sp} />
      {rows.length === 0 && <div className="card"><Empty>لا توجد قرارات</Empty></div>}
      {rows.map(({ s, player, staffName }) => {
        const ap = aps.filter((a) => a.sanctionId === s.id);
        const canAppeal = u.can("club.appeals") && s.status === "ACTIVE" && (!s.appealDeadline || s.appealDeadline >= t) && !ap.some((a) => a.status === "PENDING");
        return (
          <div key={s.id} className="card">
            <div className="card-head">
              <h3>{s.number} — {SANCTION_TYPE[s.type]}</h3>
              <Badge v={SANCTION_STATUS[s.status]} />
              <Link className="btn btn-sm btn-light" href={`/print/sanction/${s.id}`} target="_blank">🖨 القرار</Link>
            </div>
            <p className="mb0"><strong>{s.targetType === "CLUB" ? "النادي" : `${player ?? staffName} (${SANCTION_TARGET[s.targetType]})`}</strong> — {fmtDate(s.decisionDate)}
              {s.matchesCount ? ` — ${s.matchesCount} مباراة` : ""}{s.toDate ? ` — حتى ${fmtDate(s.toDate)}` : ""}{s.points ? ` — خصم ${s.points} نقطة` : ""}{Number(s.fineAmount) > 0 ? ` — غرامة ${money(s.fineAmount)}` : ""}</p>
            <p className="muted">{s.reason}</p>
            {ap.map((a) => <div key={a.id} className="alert info">طعنكم ({fmtDate(a.submittedAt)}): <Badge v={APPEAL_STATUS[a.status]} /> {a.decision && <> — {a.decision}</>}</div>)}
            {canAppeal && (
              <details className="box"><summary>تقديم طعن (حتى {fmtDate(s.appealDeadline)})</summary>
                <form action={submitAppeal} className="stack mt">
                  <input type="hidden" name="sanctionId" value={s.id} />
                  <textarea name="text" required placeholder="أسباب الطعن والوقائع" />
                  <label>مستند داعم (اختياري)<input type="file" name="document" accept="application/pdf,image/*" /></label>
                  <div><Submit confirm="تقديم الطعن؟">تقديم الطعن</Submit></div>
                </form>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
