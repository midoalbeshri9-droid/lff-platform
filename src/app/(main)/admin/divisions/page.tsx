import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { divisions, clubs, competitions, officials, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { PageHead, Flash, Field, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveDivision, saveClubDivisions } from "../actions";

export default async function Divisions({ searchParams }: { searchParams: SP }) {
  await requireUser("admin.clubs");
  const sp = await searchParams;
  const dv = await db.select().from(divisions).orderBy(divisions.level, divisions.name);
  const cnt = async (t: typeof clubs | typeof competitions | typeof officials, col: typeof clubs.divisionId | typeof competitions.divisionId | typeof officials.divisionId) =>
    db.select({ d: col, n: sql<number>`count(*)::int` }).from(t).groupBy(col);
  const [cc, cm, co] = await Promise.all([cnt(clubs, clubs.divisionId), cnt(competitions, competitions.divisionId), cnt(officials, officials.divisionId)]);
  const mgrs = await db.select({ name: users.fullName, role: users.role, d: users.divisionId, active: users.isActive }).from(users).where(sql`${users.divisionId} is not null`);
  const cl = await db.select({ id: clubs.id, name: clubs.name, city: clubs.city, d: clubs.divisionId, active: clubs.isActive }).from(clubs).orderBy(clubs.name);
  const n = (rows: { d: number | null; n: number }[], id: number | null) => rows.find((x) => x.d === id)?.n ?? 0;
  return (
    <>
      <PageHead title="الدرجات" sub="درجات المسابقات وأنديتها ومديروها — مدير الدرجة لا يرى ولا يدير إلا ما يخص درجته" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        {dv.length === 0 ? <Empty>لا درجات</Empty> : (
          <table className="t"><thead><tr><th>المستوى</th><th>الدرجة</th><th className="num">الأندية</th><th className="num">المسابقات</th><th className="num">الحكام والمراقبون</th><th>المديرون والموظفون</th><th></th></tr></thead>
            <tbody>{dv.map((d) => (
              <tr key={d.id} className={d.isActive ? "" : "muted"}>
                <td className="num">{d.level}</td><td><strong>{d.name}</strong></td>
                <td className="num">{n(cc, d.id)}</td><td className="num">{n(cm, d.id)}</td><td className="num">{n(co, d.id)}</td>
                <td style={{ fontSize: ".85rem" }}>{mgrs.filter((m) => m.d === d.id).map((m) => `${m.name} (${ROLE_LABEL[m.role]})`).join("، ") || <Link href="/admin/users">+ إنشاء مدير</Link>}</td>
                <td><details><summary className="btn btn-sm btn-light">تعديل</summary>
                  <form action={saveDivision} className="form f2 mt"><input type="hidden" name="id" value={d.id} />
                    <Field label="الاسم"><input type="text" name="name" defaultValue={d.name} required /></Field>
                    <Field label="المستوى"><input type="number" name="level" defaultValue={d.level} min={1} /></Field>
                    <label className="check"><input type="checkbox" name="isActive" value="1" defaultChecked={d.isActive} /> فعّالة</label>
                    <Submit className="btn btn-sm">حفظ</Submit></form></details></td>
              </tr>
            ))}
              <tr className="muted"><td></td><td>غير مصنف (اتحادي)</td><td className="num">{n(cc, null)}</td><td className="num">{n(cm, null)}</td><td className="num">{n(co, null)}</td><td colSpan={2} style={{ fontSize: ".8rem" }}>المسابقات غير المصنفة (كالكأس) والحكام غير المصنفين يديرها الاتحاد؛ ويمكن لمديري الدرجات تعيين الحكام غير المصنفين.</td></tr>
            </tbody></table>
        )}
        <details className="mt"><summary>+ درجة جديدة</summary>
          <form action={saveDivision} className="form f3 mt">
            <Field label="الاسم"><input type="text" name="name" required placeholder="الدرجة الثانية" /></Field>
            <Field label="المستوى" hint="1 = الأعلى"><input type="number" name="level" defaultValue={dv.length + 1} min={1} /></Field>
            <div style={{ alignSelf: "end" }}><Submit>إضافة</Submit></div>
          </form>
        </details>
      </div>

      <form action={saveClubDivisions} className="card table-wrap">
        <div className="card-head"><h3>توزيع الأندية على الدرجات (الصعود والهبوط)</h3><Submit>💾 حفظ التوزيع</Submit></div>
        <table className="t"><thead><tr><th>النادي</th><th>المدينة</th><th>الدرجة</th></tr></thead>
          <tbody>{cl.map((c) => (
            <tr key={c.id} className={c.active ? "" : "muted"}><td><strong>{c.name}</strong></td><td>{c.city}</td>
              <td><select name={`d_${c.id}`} defaultValue={c.d ?? ""} style={{ width: "auto" }}><option value="">— غير مصنف —</option>{dv.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td></tr>
          ))}</tbody></table>
      </form>
    </>
  );
}
