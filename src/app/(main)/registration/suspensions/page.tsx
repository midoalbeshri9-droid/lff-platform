import Link from "next/link";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { suspensions, players, competitions, registrations } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Empty, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { addSuspension, liftSuspension } from "../actions";

export default async function Suspensions({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view", "comp.view");
  const sp = await searchParams;
  const sc = await scopeOf(u);
  const kind = sp.kind === "MATCHES" ? "MATCHES" : sp.kind === "ADMIN" ? "ADMIN" : undefined;
  const rows = await db
    .select({ s: suspensions, name: players.fullName, comp: competitions.name })
    .from(suspensions).innerJoin(players, eq(players.id, suspensions.playerId)).leftJoin(competitions, eq(competitions.id, suspensions.competitionId))
    .where(and(sc ? inArray(suspensions.playerId, db.select({ id: registrations.playerId }).from(registrations).where(regIn(sc))) : undefined, kind ? eq(suspensions.kind, kind) : undefined, sp.all ? undefined : eq(suspensions.isLifted, false)))
    .orderBy(desc(suspensions.id)).limit(400);
  const t = today();
  const active = rows.filter(({ s }) => s.kind === "ADMIN" ? !s.endDate || s.endDate >= t : (s.matchesTotal ?? 0) > s.matchesServed);
  const list = sp.all ? rows : active;
  const comps = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).orderBy(desc(competitions.id));
  const back = `/registration/suspensions${kind ? "?kind=" + kind : ""}`;
  return (
    <>
      <PageHead title="الإيقافات" sub="الإيقاف الإداري (لجنة القيد) والإيقاف بعدد مباريات (لجنة المسابقات) — يمنع النظام إشراك الموقوف تلقائيًا" />
      <Flash sp={sp} />
      <div className="tabs">
        <Link className={`tab ${!kind ? "active" : ""}`} href="/registration/suspensions">الكل</Link>
        <Link className={`tab ${kind === "ADMIN" ? "active" : ""}`} href="/registration/suspensions?kind=ADMIN">إدارية</Link>
        <Link className={`tab ${kind === "MATCHES" ? "active" : ""}`} href="/registration/suspensions?kind=MATCHES">بعدد مباريات</Link>
        <Link className={`tab ${sp.all ? "active" : ""}`} href={`/registration/suspensions?all=1${kind ? "&kind=" + kind : ""}`}>تشمل المنتهية</Link>
      </div>
      <div className="card table-wrap">
        {list.length === 0 ? <Empty>لا توجد إيقافات سارية</Empty> : (
          <table className="t"><thead><tr><th>اللاعب</th><th>النوع</th><th>السبب</th><th>المسابقة</th><th>المدة / المتبقي</th><th>بواسطة</th><th></th></tr></thead>
            <tbody>{list.map(({ s, name, comp }) => (
              <tr key={s.id}>
                <td><Link href={`/registration/players/${s.playerId}`}><strong>{name}</strong></Link></td>
                <td>{s.kind === "ADMIN" ? <span className="b b-red">إداري</span> : <span className="b b-amber">مباريات</span>}{s.isAutomatic && <span className="b b-gray">تلقائي</span>}</td>
                <td>{s.reason}</td><td>{comp ?? "الكل"}</td>
                <td>{s.kind === "ADMIN" ? `${fmtDate(s.startDate)} ← ${s.endDate ? fmtDate(s.endDate) : "مفتوح"}` : `متبقٍ ${(s.matchesTotal ?? 0) - s.matchesServed} من ${s.matchesTotal}`}</td>
                <td>{s.createdBy}</td>
                <td>{!s.isLifted && u.can(s.kind === "ADMIN" ? "reg.suspend" : "comp.suspend") && (
                  <form action={liftSuspension}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={back} /><Submit className="btn btn-sm btn-light" confirm="رفع الإيقاف؟">رفع</Submit></form>)}</td>
              </tr>))}</tbody></table>
        )}
      </div>
      {u.canAny("reg.suspend", "comp.suspend") && (
        <div className="card">
          <h2>تسجيل إيقاف جديد</h2>
          <form action={addSuspension} className="form f3">
            <input type="hidden" name="back" value={back} />
            <Field label="رقم اللاعب في المنظومة" hint="من ملف اللاعب (رقم #)"><input type="number" name="playerId" required /></Field>
            <Field label="النوع"><select name="kind">{u.can("reg.suspend") && <option value="ADMIN">إداري (بمدة)</option>}{u.can("comp.suspend") && <option value="MATCHES">بعدد مباريات</option>}</select></Field>
            <Field label="عدد المباريات (لإيقاف المباريات)"><input type="number" name="matchesTotal" min={1} /></Field>
            <Field label="المسابقة (اختياري)"><select name="competitionId"><option value="">كل المسابقات</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="من"><input type="date" name="startDate" defaultValue={t} /></Field>
            <Field label="إلى (للإداري)"><input type="date" name="endDate" /></Field>
            <Field label="السبب" full><textarea name="reason" required /></Field>
            <div className="full"><Submit className="btn btn-danger">تسجيل الإيقاف</Submit></div>
          </form>
        </div>
      )}
    </>
  );
}
