import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { archiveDocs, clubs, competitions, seasons, correspondence, decisions, regulations, meetings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { visibleWhere, fmtSize } from "@/lib/archive";
import { ARCHIVE_CATEGORY, COMMITTEE, CONFIDENTIALITY } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Field, Empty, Badge, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { uploadDocs } from "./actions";
import { ArchiveFields } from "./ArchiveFields";

const ICON = (m: string | null) => (m?.includes("pdf") ? "📕" : m?.startsWith("image") ? "🖼" : m?.includes("word") ? "📘" : m?.includes("sheet") || m?.includes("excel") ? "📗" : "📄");

export default async function Archive({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("archive.view");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const like = q ? `%${q}%` : null;
  const deleted = sp.deleted === "1" && u.can("archive.secret");
  const rows = await db.select({ d: archiveDocs, club: clubs.name }).from(archiveDocs).leftJoin(clubs, eq(clubs.id, archiveDocs.clubId))
    .where(and(
      eq(archiveDocs.isDeleted, deleted), visibleWhere(u),
      like ? or(ilike(archiveDocs.title, like), ilike(archiveDocs.number, like), ilike(archiveDocs.description, like), ilike(archiveDocs.tags, like), ilike(archiveDocs.refNumber, like), ilike(archiveDocs.fileName, like)) : undefined,
      sp.cat ? eq(archiveDocs.category, sp.cat) : undefined, sp.committee ? eq(archiveDocs.committee, sp.committee) : undefined,
      sp.club ? eq(archiveDocs.clubId, Number(sp.club)) : undefined, sp.season ? eq(archiveDocs.seasonId, Number(sp.season)) : undefined,
      sp.player ? eq(archiveDocs.playerId, Number(sp.player)) : undefined, sp.match ? eq(archiveDocs.matchId, Number(sp.match)) : undefined,
      sp.year ? sql`extract(year from coalesce(${archiveDocs.docDate}, ${archiveDocs.createdAt}::date)) = ${Number(sp.year)}` : undefined,
    )).orderBy(desc(archiveDocs.docDate), desc(archiveDocs.id)).limit(300);
  const counts = await db.select({ c: archiveDocs.category, n: sql<number>`count(*)::int` }).from(archiveDocs).where(and(eq(archiveDocs.isDeleted, false), visibleWhere(u))).groupBy(archiveDocs.category);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const cs = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).orderBy(desc(competitions.id));
  const ss = await db.select({ id: seasons.id, name: seasons.name }).from(seasons).orderBy(desc(seasons.startDate));
  // البحث الموحد في أقسام المنظومة الأخرى
  const other = like ? {
    mail: u.can("sec.view") ? await db.select().from(correspondence).where(or(ilike(correspondence.subject, like), ilike(correspondence.number, like), ilike(correspondence.party, like))).limit(10) : [],
    dec: u.can("sec.view") ? await db.select().from(decisions).where(or(ilike(decisions.title, like), ilike(decisions.number, like), ilike(decisions.text, like))).limit(10) : [],
    meet: u.can("sec.view") ? await db.select().from(meetings).where(or(ilike(meetings.number, like), ilike(meetings.agenda, like), ilike(meetings.minutes, like))).limit(10) : [],
    regs: await db.select().from(regulations).where(and(eq(regulations.isActive, true), ilike(regulations.title, like))).limit(10),
  } : null;
  const otherCount = other ? other.mail.length + other.dec.length + other.meet.length + other.regs.length : 0;
  const total = counts.reduce((t, x) => t + x.n, 0);
  return (
    <>
      <PageHead title="الأرشيف الإلكتروني" sub={`${total.toLocaleString("en")} وثيقة — حفظ وثائق الاتحاد وتصنيفها والبحث فيها حسب الصلاحية والسرية`} />
      <Flash sp={sp} />
      <div className="arch-cats">
        <Link href="/archive" className={`arch-cat ${!sp.cat ? "active" : ""}`}>الكل <b>{total}</b></Link>
        {Object.entries(ARCHIVE_CATEGORY).map(([k, v]) => {
          const n = counts.find((x) => x.c === k)?.n ?? 0;
          return n || sp.cat === k ? <Link key={k} href={`?cat=${k}`} className={`arch-cat ${sp.cat === k ? "active" : ""}`}>{v} <b>{n}</b></Link> : null;
        })}
      </div>
      <form className="filters">
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        <div className="field" style={{ flex: 2 }}><label>بحث</label><input type="text" name="q" defaultValue={q ?? ""} placeholder="العنوان، الرقم، الوصف، الكلمات المفتاحية، اسم الملف" /></div>
        <div className="field"><label>اللجنة</label><select name="committee" defaultValue={sp.committee ?? ""}><option value="">الكل</option><Options map={COMMITTEE} /></select></div>
        <div className="field"><label>النادي</label><select name="club" defaultValue={sp.club ?? ""}><option value="">الكل</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>الموسم</label><select name="season" defaultValue={sp.season ?? ""}><option value="">الكل</option>{ss.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>السنة</label><input type="number" name="year" defaultValue={sp.year ?? ""} style={{ width: 90 }} /></div>
        {u.can("archive.secret") && <label className="check"><input type="checkbox" name="deleted" value="1" defaultChecked={deleted} /> المحذوفة</label>}
        <button className="btn btn-light">بحث</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا وثائق مطابقة</Empty> : (
          <table className="t"><thead><tr><th>الرقم</th><th>الوثيقة</th><th>التصنيف</th><th>اللجنة</th><th>التاريخ</th><th>النادي</th><th>السرية</th><th></th></tr></thead>
            <tbody>{rows.map(({ d, club }) => (
              <tr key={d.id}>
                <td className="kbd nowrap">{d.number}</td>
                <td>{ICON(d.mime)} <Link href={`/archive/${d.id}`}><strong>{d.title}</strong></Link>{d.refNumber && <span className="muted"> ({d.refNumber})</span>}<div className="muted" style={{ fontSize: ".75rem" }}>{d.fileName} {fmtSize(d.size)}</div></td>
                <td>{ARCHIVE_CATEGORY[d.category]}</td><td>{d.committee ? COMMITTEE[d.committee] : ""}</td><td className="nowrap">{fmtDate(d.docDate)}</td><td>{club}</td>
                <td><Badge v={CONFIDENTIALITY[d.confidentiality]} /></td>
                <td><a className="btn btn-sm btn-light" href={`/api/files/${d.fileKey}`} target="_blank">فتح</a></td>
              </tr>
            ))}</tbody></table>
        )}
      </div>
      {other && otherCount > 0 && (
        <div className="card">
          <h3>نتائج من أقسام المنظومة الأخرى ({otherCount})</h3>
          <ul className="arch-other">
            {other.mail.map((c) => <li key={`m${c.id}`}>✉ <Link href={`/secretariat/mail/${c.id}`}>{c.number} — {c.subject}</Link> <span className="muted">({c.direction === "IN" ? "وارد" : "صادر"}، {fmtDate(c.date)})</span></li>)}
            {other.dec.map((d) => <li key={`d${d.id}`}>📌 <Link href="/secretariat/decisions">{d.number} — {d.title}</Link> <span className="muted">({fmtDate(d.date)})</span></li>)}
            {other.meet.map((m) => <li key={`t${m.id}`}>📝 <Link href={`/secretariat/meetings/${m.id}`}>محضر {m.number}</Link> <span className="muted">({fmtDate(m.date)})</span></li>)}
            {other.regs.map((r) => <li key={`r${r.id}`}>📚 <a href={`/api/files/${r.fileKey}`} target="_blank">{r.title}</a></li>)}
          </ul>
        </div>
      )}
      {u.can("archive.manage") && (
        <details className="card" open={total === 0}>
          <summary>+ أرشفة وثائق</summary>
          <form action={uploadDocs} className="form f3 mt">
            <Field label="الملفات *" hint="PDF أو صور أو Word أو Excel — حتى 12 م.ب للملف، ويمكن اختيار عدة ملفات (حتى 30) بالبيانات نفسها" full>
              <input type="file" name="files" multiple required accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" />
            </Field>
            <Field label="العنوان" hint="مطلوب لملف واحد — مع عدة ملفات يُضاف اسم كل ملف" full><input type="text" name="title" /></Field>
            <ArchiveFields clubs={cl} comps={cs} seasons={ss} canSecret={u.can("archive.secret")} />
            <div className="full"><Submit>📥 أرشفة</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
