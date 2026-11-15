import Link from "next/link";
import { and, eq, or, ilike, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { players, registrations, clubs, seasons } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { REG_STATUS, REG_TYPE } from "@/lib/labels";
import { getCurrentSeason } from "@/lib/registration";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Badge, Field, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { PlayerFields } from "@/components/PlayerForm";
import { createPlayerAndRequest, requestExisting } from "../../actions";

type Mode = "new" | "transfer" | "return" | "any";
const HEAD: Record<Mode, { title: string; hint: string; crumb: [string, string] }> = {
  new: { title: "➕ تسجيل لاعب جديد", hint: "للاعب لم يُسجَّل في المنظومة من قبل لدى أي نادٍ. ابحث برقمه الوطني أو جوازه أولًا للتأكد.", crumb: ["طلبات التسجيل الجديد", "/club/requests?kind=new"] },
  transfer: { title: "⇄ ضم لاعب من نادٍ آخر", hint: "انتقال نهائي أو إعارة للاعب مقيّد لدى نادٍ آخر. يُبلَّغ ناديه ويُطلب رأيه قبل اعتماد اللجنة.", crumb: ["طلبات الانتقال والإعارة", "/club/requests?kind=transfer"] },
  return: { title: "↩ عودة لاعب من إعارة", hint: "لاعب ناديكم المُعار حاليًا لنادٍ آخر ويعود إليكم.", crumb: ["طلبات الانتقال والإعارة", "/club/requests?kind=transfer"] },
  any: { title: "إضافة لاعب / طلب قيد", hint: "ابحث بالرقم الوطني أو رقم الجواز. إذا كان اللاعب مسجلًا ستُنشئ طلب تجديد أو انتقال أو إعارة بدل تسجيله من جديد.", crumb: ["لاعبو النادي", "/club/players"] },
};

export default async function NewPlayer({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.edit");
  const sp = await searchParams;
  const mode: Mode = sp.mode === "new" || sp.mode === "transfer" || sp.mode === "return" ? sp.mode : "any";
  const h = HEAD[mode];
  const q = sp.q?.trim();
  const found = q
    ? await db.select().from(players).where(
        /^\d+$/.test(q) && q.length < 8 ? eq(players.id, Number(q)) : or(eq(players.nationalId, q), eq(players.passportNo, q), ilike(players.fullName, q)),
      ).limit(5)
    : [];
  const history = found.length
    ? await db.select({ r: registrations, club: clubs.name, season: seasons.name }).from(registrations)
        .innerJoin(clubs, eq(clubs.id, registrations.clubId)).innerJoin(seasons, eq(seasons.id, registrations.seasonId))
        .where(or(...found.map((p) => eq(registrations.playerId, p.id)))).orderBy(desc(registrations.id))
    : [];
  // لاعبونا المعارون حاليًا لأندية أخرى (لقسم العودة من الإعارة)
  const season = await getCurrentSeason();
  const lc = alias(clubs, "lc");
  const loanedOut = mode === "return" && season
    ? await db.select({ r: registrations, name: players.fullName, nid: players.nationalId, club: lc.name }).from(registrations)
        .innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(lc, eq(lc.id, registrations.clubId))
        .where(and(eq(registrations.type, "LOAN"), eq(registrations.status, "APPROVED"), eq(registrations.seasonId, season.id), eq(registrations.fromClubId, u.clubId)))
    : [];
  const lastClub = (pid: number) => history.find((x) => x.r.playerId === pid && ["APPROVED", "EXPIRED", "TRANSFERRED"].includes(x.r.status));
  const History = ({ pid }: { pid: number }) => (
    <table className="t"><tbody>{history.filter((x) => x.r.playerId === pid).map((x) => (
      <tr key={x.r.id}><td>{x.season}</td><td>{x.club}</td><td>{REG_TYPE[x.r.type]}</td><td><Badge v={REG_STATUS[x.r.status]} /></td></tr>))}</tbody></table>
  );

  return (
    <>
      <PageHead title={h.title} sub={h.hint} crumbs={[h.crumb, [h.title.replace(/^\S+\s/, "")]]} />
      <Flash sp={sp} />

      {mode === "return" && (
        <div className="card table-wrap">
          <h2>لاعبونا المعارون حاليًا</h2>
          {loanedOut.length === 0 ? <Empty>لا يوجد لاعبون معارون من ناديكم هذا الموسم</Empty> : (
            <table className="t"><thead><tr><th>اللاعب</th><th>معار إلى</th><th>نهاية الإعارة</th><th></th></tr></thead>
              <tbody>{loanedOut.map((x) => (
                <tr key={x.r.id} className={x.r.loanEndDate && x.r.loanEndDate < new Date().toISOString().slice(0, 10) ? "hl" : ""}>
                  <td><strong>{x.name}</strong><div className="kbd muted" style={{ fontSize: ".8rem" }}>{x.nid}</div></td><td>{x.club}</td><td>{fmtDate(x.r.loanEndDate)}</td>
                  <td><form action={requestExisting}><input type="hidden" name="playerId" value={x.r.playerId} /><input type="hidden" name="type" value="LOAN_RETURN" /><input type="hidden" name="mode" value="return" /><Submit className="btn btn-sm btn-primary">↩ طلب عودة</Submit></form></td>
                </tr>))}</tbody></table>)}
        </div>
      )}

      {mode !== "return" && (
        <div className="card">
          <h2>1) ابحث عن اللاعب</h2>
          <form className="filters" style={{ marginBottom: 0 }}>
            <input type="hidden" name="mode" value={mode === "any" ? "" : mode} />
            <div className="field grow"><label>الرقم الوطني / الجواز</label><input type="search" name="q" dir="ltr" defaultValue={q} required /></div>
            <button className="btn btn-primary">بحث</button>
          </form>
        </div>
      )}

      {q && found.map((p) => {
        const lc0 = lastClub(p.id);
        const ours = lc0?.r.clubId === u.clubId;
        // تسجيل جديد للاعب موجود: لا يُسجَّل مرتين — نوجّهه للمسار الصحيح
        if (mode === "new") return (
          <div className="card" key={p.id}>
            <div className="alert warn"><strong>اللاعب {p.fullName} مسجّل مسبقًا في المنظومة</strong> — لا يُسجَّل كلاعب جديد.</div>
            <History pid={p.id} />
            <div className="btn-row mt">
              {ours ? <Link className="btn btn-primary" href="/club/renew">🔄 جدّد قيده من صفحة التجديد</Link>
                : <Link className="btn btn-primary" href={`/club/players/new?mode=transfer&q=${encodeURIComponent(q)}`}>⇄ ضمه بانتقال أو إعارة</Link>}
            </div>
          </div>
        );
        return (
          <div className="card" key={p.id}>
            <div className="card-head"><h2>✓ {p.fullName}</h2>{lc0 && <span className="b b-blue">آخر نادٍ: {lc0.club}</span>}</div>
            <dl className="dl"><dt>الرقم الوطني</dt><dd className="kbd">{p.nationalId ?? "—"}</dd><dt>تاريخ الميلاد</dt><dd>{fmtDate(p.dateOfBirth)}</dd></dl>
            <h3 className="mt">سجل القيد</h3>
            <History pid={p.id} />
            {mode === "transfer" && ours ? (
              <div className="alert info mt">اللاعب آخر قيد له لدى ناديكم — هذا تجديد وليس انتقالًا. <Link href="/club/renew">اذهب إلى التجديد ←</Link></div>
            ) : (
              <form action={requestExisting} className="form mt">
                <input type="hidden" name="playerId" value={p.id} /><input type="hidden" name="mode" value={mode} />
                <Field label="نوع الطلب" hint={mode === "any" ? "يحدد النظام النوع الصحيح تلقائيًا حسب وضع اللاعب" : undefined}>
                  <select name="type" defaultValue={mode === "transfer" ? "TRANSFER" : "RENEWAL"}>
                    {mode === "any" && <option value="RENEWAL">تجديد قيد (لاعب لدى ناديكم سابقًا)</option>}
                    <option value="TRANSFER">انتقال نهائي من نادٍ آخر</option>
                    <option value="LOAN">إعارة من نادٍ آخر</option>
                    {mode === "any" && <option value="LOAN_RETURN">عودة من إعارة</option>}
                  </select>
                </Field>
                <Field label="نهاية الإعارة (للإعارة فقط)"><input type="date" name="loanEndDate" /></Field>
                <div className="full"><Submit>إنشاء الطلب</Submit></div>
              </form>
            )}
          </div>
        );
      })}

      {q && found.length === 0 && mode === "transfer" && (
        <div className="card"><div className="alert warn">لا يوجد لاعب بهذا الرقم في المنظومة — إن لم يُسجَّل من قبل لدى أي نادٍ فهو تسجيل جديد.</div>
          <Link className="btn btn-primary" href={`/club/players/new?mode=new&q=${encodeURIComponent(q)}`}>➕ تسجيله كلاعب جديد</Link></div>
      )}

      {q && found.length === 0 && mode !== "transfer" && mode !== "return" && (
        <div className="card">
          <h2>2) لاعب جديد — غير مسجل في المنظومة</h2>
          <form action={createPlayerAndRequest} className="form">
            <PlayerFields p={{ nationalId: /^\d{12}$/.test(q) ? q : null, passportNo: /^\d{12}$/.test(q) ? null : q }} photoRequired />
            <Field label="رقم القميص"><input type="number" name="shirtNumber" min={1} max={99} /></Field>
            <div className="full"><Submit>حفظ كمسودة والانتقال لرفع المستندات</Submit></div>
          </form>
        </div>
      )}
    </>
  );
}
