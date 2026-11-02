import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { archiveDocs, archiveVersions, clubs, competitions, seasons, players, officials, auditLogs } from "@/db/schema";
import { and } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { canSeeDoc, fmtSize } from "@/lib/archive";
import { ARCHIVE_CATEGORY, COMMITTEE, CONFIDENTIALITY } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Field, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { updateDoc, deleteDoc, restoreDoc } from "../actions";
import { ArchiveFields } from "../ArchiveFields";

export default async function ArchiveDoc({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("archive.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [d] = await db.select().from(archiveDocs).where(eq(archiveDocs.id, id));
  if (!d) notFound();
  if (!canSeeDoc(u, d) || (d.isDeleted && !u.can("archive.secret"))) redirect("/denied");
  const name = async <T,>(q: Promise<T[]>) => (await q)[0];
  const club = d.clubId ? await name(db.select({ n: clubs.name }).from(clubs).where(eq(clubs.id, d.clubId))) : null;
  const comp = d.competitionId ? await name(db.select({ n: competitions.name }).from(competitions).where(eq(competitions.id, d.competitionId))) : null;
  const season = d.seasonId ? await name(db.select({ n: seasons.name }).from(seasons).where(eq(seasons.id, d.seasonId))) : null;
  const player = d.playerId ? await name(db.select({ n: players.fullName }).from(players).where(eq(players.id, d.playerId))) : null;
  const official = d.officialId ? await name(db.select({ n: officials.fullName }).from(officials).where(eq(officials.id, d.officialId))) : null;
  const versions = await db.select().from(archiveVersions).where(eq(archiveVersions.docId, id)).orderBy(desc(archiveVersions.replacedAt));
  const log = u.can("archive.secret") ? await db.select().from(auditLogs).where(and(eq(auditLogs.entity, "ArchiveDoc"), eq(auditLogs.entityId, String(id)))).orderBy(desc(auditLogs.id)).limit(30) : [];
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const cs = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).orderBy(desc(competitions.id));
  const ss = await db.select({ id: seasons.id, name: seasons.name }).from(seasons).orderBy(desc(seasons.startDate));
  const isImg = d.mime?.startsWith("image"), isPdf = d.mime?.includes("pdf");
  const manage = u.can("archive.manage") && !d.isDeleted;
  return (
    <>
      <PageHead title={d.title} sub={<>{d.number} — {ARCHIVE_CATEGORY[d.category]} — <Badge v={CONFIDENTIALITY[d.confidentiality]} /></>} crumbs={[["الأرشيف", "/archive"], [d.number]]}
        actions={<a className="btn btn-primary" href={`/api/files/${d.fileKey}`} target="_blank">⬇ فتح / تنزيل</a>} />
      <Flash sp={sp} />
      {d.isDeleted && <div className="alert err">هذه الوثيقة محذوفة. <form action={restoreDoc} style={{ display: "inline" }}><input type="hidden" name="id" value={d.id} /><Submit className="btn btn-sm btn-light">استعادة</Submit></form></div>}
      <div className="grid g2">
        <div>
          <div className="card">
            <dl className="dl">
              <dt>رقم الأرشيف</dt><dd className="kbd">{d.number}</dd>
              {d.refNumber && <><dt>الرقم الأصلي</dt><dd>{d.refNumber}</dd></>}
              <dt>تاريخ الوثيقة</dt><dd>{fmtDate(d.docDate)}</dd>
              {d.committee && <><dt>اللجنة</dt><dd>{COMMITTEE[d.committee]}</dd></>}
              {season && <><dt>الموسم</dt><dd>{season.n}</dd></>}
              {club && <><dt>النادي</dt><dd><Link href={`/archive?club=${d.clubId}`}>{club.n}</Link></dd></>}
              {comp && <><dt>المسابقة</dt><dd><Link href={`/competitions/${d.competitionId}`}>{comp.n}</Link></dd></>}
              {player && <><dt>اللاعب</dt><dd><Link href={`/registration/players/${d.playerId}`}>{player.n}</Link></dd></>}
              {d.matchId && <><dt>المباراة</dt><dd><Link href={`/matches/${d.matchId}`}>#{d.matchId}</Link></dd></>}
              {official && <><dt>الحكم / المراقب</dt><dd><Link href={`/referees/${d.officialId}`}>{official.n}</Link></dd></>}
              {d.physicalLocation && <><dt>النسخة الورقية</dt><dd>📦 {d.physicalLocation}</dd></>}
              {d.retentionUntil && <><dt>الاحتفاظ حتى</dt><dd>{fmtDate(d.retentionUntil)}</dd></>}
              {d.tags && <><dt>كلمات مفتاحية</dt><dd>{d.tags.split(",").map((t) => <Link key={t} href={`/archive?q=${encodeURIComponent(t.trim())}`} className="b b-gray" style={{ marginInlineEnd: 4 }}>{t.trim()}</Link>)}</dd></>}
              <dt>الملف</dt><dd>{d.fileName} — {fmtSize(d.size)}</dd>
              <dt>أرشفها</dt><dd>{d.createdBy} — {fmtDateTime(d.createdAt)}</dd>
            </dl>
            {d.description && <div className="doc-text mt">{d.description}</div>}
          </div>
          {(isImg || isPdf) && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {isImg ? <img src={`/api/files/${d.fileKey}`} alt={d.title} style={{ width: "100%", display: "block" }} /> : <iframe src={`/api/files/${d.fileKey}`} title={d.title} style={{ width: "100%", height: 560, border: 0 }} />}
            </div>
          )}
        </div>
        <div>
          {manage && (
            <details className="card">
              <summary>تعديل البيانات / استبدال الملف</summary>
              <form action={updateDoc} className="form f2 mt">
                <input type="hidden" name="id" value={d.id} />
                <Field label="العنوان *" full><input type="text" name="title" defaultValue={d.title} required /></Field>
                <ArchiveFields d={d} clubs={cl} comps={cs} seasons={ss} canSecret={u.can("archive.secret")} />
                <Field label="استبدال الملف (تُحفظ النسخة السابقة)"><input type="file" name="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" /></Field>
                <Field label="سبب الاستبدال"><input type="text" name="versionNote" /></Field>
                <div className="full"><Submit>حفظ</Submit></div>
              </form>
            </details>
          )}
          {versions.length > 0 && (
            <div className="card table-wrap"><h3>النسخ السابقة</h3>
              <table className="t"><tbody>{versions.map((v) => <tr key={v.id}><td>{fmtDateTime(v.replacedAt)}</td><td>{v.replacedBy}</td><td>{v.note}</td><td><a href={`/api/files/${v.fileKey}`} target="_blank">{v.fileName ?? "فتح"}</a></td></tr>)}</tbody></table>
            </div>
          )}
          {log.length > 0 && (
            <div className="card table-wrap"><h3>سجل الاطلاع والتعديل</h3>
              <table className="t"><tbody>{log.map((l) => <tr key={l.id}><td className="nowrap">{fmtDateTime(l.at)}</td><td>{l.userName}</td><td>{l.action}</td></tr>)}</tbody></table>
            </div>
          )}
          {manage && (
            <details className="card"><summary className="danger-text">حذف الوثيقة</summary>
              <form action={deleteDoc} className="row mt"><input type="hidden" name="id" value={d.id} />
                <input type="text" name="reason" placeholder="سبب الحذف" required style={{ flex: 1 }} /><Submit className="btn btn-danger" confirm="حذف الوثيقة من الأرشيف؟">حذف</Submit></form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
