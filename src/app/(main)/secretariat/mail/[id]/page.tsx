import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { correspondence, clubs, players } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { COMMITTEE, CORR_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { setCorrespondenceStatus } from "../../actions";
import { CorrForm } from "../form";

export default async function MailItem({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("sec.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [c] = await db.select().from(correspondence).where(eq(correspondence.id, id));
  if (!c) notFound();
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const [player] = c.playerId ? await db.select({ name: players.fullName }).from(players).where(eq(players.id, c.playerId)) : [];
  const replies = await db.select().from(correspondence).where(eq(correspondence.replyToId, id)).orderBy(desc(correspondence.date));
  const [orig] = c.replyToId ? await db.select().from(correspondence).where(eq(correspondence.id, c.replyToId)) : [];
  const manage = u.can("sec.manage");
  return (
    <>
      <PageHead title={`${c.direction === "IN" ? "وارد" : "صادر"} رقم ${c.number}`} sub={<>{c.subject} — <Badge v={CORR_STATUS[c.status]} /></>} crumbs={[["الصادر والوارد", "/secretariat/mail"], [c.number]]} />
      <Flash sp={sp} />
      <div className="grid g2">
        <div className="card">
          <dl className="dl">
            <dt>التاريخ</dt><dd>{fmtDate(c.date)}</dd>
            <dt>{c.direction === "IN" ? "من" : "إلى"}</dt><dd>{c.party}</dd>
            {c.refNumber && <><dt>رقم الجهة</dt><dd>{c.refNumber}</dd></>}
            {c.committee && <><dt>اللجنة المختصة</dt><dd>{COMMITTEE[c.committee]}</dd></>}
            {c.clubId && <><dt>النادي</dt><dd>{cl.find((x) => x.id === c.clubId)?.name}{c.visibleToClub && " (ظاهرة في بوابة النادي)"}</dd></>}
            {player && <><dt>اللاعب</dt><dd><Link href={`/registration/players/${c.playerId}`}>{player.name}</Link></dd></>}
            {c.matchId && <><dt>المباراة</dt><dd><Link href={`/matches/${c.matchId}`}>#{c.matchId}</Link></dd></>}
            {c.dueDate && <><dt>مطلوب الرد قبل</dt><dd>{fmtDate(c.dueDate)}</dd></>}
            <dt>سجّلها</dt><dd>{c.createdBy} — {fmtDateTime(c.createdAt)}</dd>
          </dl>
          {c.summary && <div className="doc-text mt">{c.summary}</div>}
          {c.fileKey && <a className="btn btn-light mt" href={`/api/files/${c.fileKey}`} target="_blank">📎 صورة الكتاب</a>}
          {orig && <p className="mt">ردًا على: <Link href={`/secretariat/mail/${orig.id}`}>{orig.number} — {orig.subject}</Link></p>}
          {replies.length > 0 && <div className="mt"><strong>الردود:</strong> {replies.map((r) => <Link key={r.id} href={`/secretariat/mail/${r.id}`} style={{ marginInlineEnd: 8 }}>{r.number}</Link>)}</div>}
          {manage && (
            <div className="row mt">
              {Object.entries(CORR_STATUS).filter(([k]) => k !== c.status).map(([k, v]) => (
                <form key={k} action={setCorrespondenceStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value={k} /><Submit className="btn btn-sm btn-light">← {v[0]}</Submit></form>
              ))}
            </div>
          )}
        </div>
        {manage && (
          <div>
            <details className="card" open>
              <summary>↩ تسجيل {c.direction === "IN" ? "رد صادر" : "رد وارد"}</summary>
              <CorrForm clubs={cl} direction={c.direction === "IN" ? "OUT" : "IN"} replyTo={c} />
            </details>
            <details className="card"><summary>تعديل البيانات</summary><CorrForm c={c} clubs={cl} /></details>
          </div>
        )}
      </div>
    </>
  );
}
