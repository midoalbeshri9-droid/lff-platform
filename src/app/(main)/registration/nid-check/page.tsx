import Link from "next/link";
import { and, eq, isNotNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, registrations, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { scopeOf, regIn } from "@/lib/scope";
import { nidMismatch, nidMode } from "@/lib/regchecks";
import { fmtDate } from "@/lib/util";
import { PageHead, Empty, Kpi, type SP } from "@/components/ui";

/** فحص الأرقام الوطنية المسجلة: هل تطابق الخانة الأولى الجنس، والخانات 2–5 سنة الميلاد؟ */
export default async function NidCheck({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view");
  const sp = await searchParams;
  const sc = await scopeOf(u);
  const rows = await db.select({ id: players.id, name: players.fullName, nid: players.nationalId, dob: players.dateOfBirth, g: players.gender }).from(players)
    .where(and(isNotNull(players.nationalId), sc ? inArray(players.id, db.select({ id: registrations.playerId }).from(registrations).where(regIn(sc))) : undefined));
  const valid = rows.filter((r) => /^\d{12}$/.test(r.nid!));
  const bad = valid.map((r) => ({ ...r, why: nidMismatch(r.nid, r.dob, r.g) })).filter((r) => r.why);
  const pct = valid.length ? Math.round(((valid.length - bad.length) / valid.length) * 1000) / 10 : 0;
  const ids = bad.slice(0, 500).map((b) => b.id);
  const cl = ids.length ? await db.selectDistinctOn([registrations.playerId], { pid: registrations.playerId, club: clubs.name }).from(registrations)
    .innerJoin(clubs, eq(clubs.id, registrations.clubId)).where(inArray(registrations.playerId, ids)).orderBy(registrations.playerId) : [];
  const mode = await nidMode();
  const show = sp.all ? bad : bad.slice(0, 200);
  return (
    <>
      <PageHead title="فحص الأرقام الوطنية" sub="الرقم الوطني الليبي: الخانة الأولى للجنس (1 ذكر، 2 أنثى) والخانات من 2 إلى 5 سنة الميلاد" crumbs={[["إعدادات القيد", "/registration/settings"], ["فحص الأرقام الوطنية"]]} />
      <div className="grid g4">
        <Kpi v={valid.length} l="رقم وطني من 12 خانة" />
        <Kpi v={`${valid.length - bad.length} (${pct}%)`} l="مطابق" />
        <Kpi v={bad.length} l="غير مطابق" color={bad.length ? "red" : undefined} />
        <Kpi v={rows.length - valid.length} l="بصيغة غير صحيحة" color="ink" />
      </div>
      <div className={`alert ${mode === "BLOCK" ? "ok" : "info"}`}>الوضع الحالي: <strong>{mode === "BLOCK" ? "منع الحفظ عند عدم التطابق" : "تنبيه للمراجع فقط"}</strong> — يُغيَّر من <Link href="/registration/settings">إعدادات القيد</Link>.
        {mode === "WARN" && valid.length >= 50 && pct >= 98 && " نسبة المطابقة عالية، ويمكن تفعيل المنع بأمان."}
        {mode === "WARN" && valid.length > 0 && pct < 98 && " راجع الحالات غير المطابقة أدناه قبل تفعيل المنع؛ قد تكون أخطاء إدخال سابقة تحتاج تصحيحًا."}</div>
      <div className="card table-wrap">
        {bad.length === 0 ? <Empty>كل الأرقام الوطنية مطابقة</Empty> : (
          <table className="t">
            <thead><tr><th>اللاعب</th><th>النادي</th><th>الرقم الوطني</th><th>الميلاد</th><th>المشكلة</th></tr></thead>
            <tbody>{show.map((b) => (
              <tr key={b.id}><td><Link href={`/registration/players/${b.id}`}>{b.name}</Link></td><td>{cl.find((c) => c.pid === b.id)?.club ?? "—"}</td>
                <td className="kbd">{b.nid}</td><td>{fmtDate(b.dob)}</td><td style={{ fontSize: ".85rem" }}>{b.why!.replace("الرقم الوطني لا يطابق البيانات: ", "")}</td></tr>))}</tbody>
          </table>)}
        {bad.length > show.length && <p><Link href="?all=1">عرض الكل ({bad.length})</Link></p>}
      </div>
    </>
  );
}
