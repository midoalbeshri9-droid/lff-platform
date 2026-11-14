import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, staff, officials, clubs, settings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { importFifaIds, type Report } from "./actions";
import { resultLabel } from "./labels";

const TARGET = { players: "اللاعبون", staff: "المدربون والإداريون", officials: "الحكام والمراقبون", clubs: "الأندية" } as const;
const TONE: Record<string, string> = { NEW: "b-blue", SET: "b-green", OVERWRITTEN: "b-green", SAME: "b-gray", CONFLICT: "b-amber", TAKEN: "b-red", NOT_FOUND: "b-red", AMBIGUOUS: "b-amber", NO_ID: "b-gray" };

/** ربط السجلات بأرقام FIFA ID من ملف مصدّر من منصة FIFA Connect */
export default async function FifaIds({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.edit");
  const sp = await searchParams;
  const n = sql<number>`count(*)::int`;
  const cov = async (t: typeof players | typeof staff | typeof officials | typeof clubs) => {
    const [a] = await db.select({ all: n, has: sql<number>`count(${t.fifaId})::int` }).from(t);
    return a;
  };
  const stats = { players: await cov(players), staff: await cov(staff), officials: await cov(officials), clubs: await cov(clubs) };
  const [s] = await db.select().from(settings).where(eq(settings.key, `fifa_import:${u.id}`));
  const rep: Report | null = s ? JSON.parse(s.value) : null;
  const filter = sp.r ?? "";
  const list = rep ? rep.rows.filter((r) => !filter || r.result === filter) : [];
  return (
    <>
      <PageHead title="أرقام FIFA ID" sub="ربط سجلات المنظومة بالمعرّف الدولي من ملف مصدّر من منصة FIFA Connect" crumbs={[["سجل اللاعبين", "/registration/players"], ["أرقام FIFA ID"]]} />
      <Flash sp={sp} />
      <div className="grid g4" style={{ marginBottom: "1rem" }}>
        {(Object.keys(TARGET) as (keyof typeof TARGET)[]).map((k, i) => (
          <div className={`kpi ${["", "gold", "ink", "red"][i]}`} key={k}><div className="v">{stats[k].has} / {stats[k].all}</div><div className="l">{TARGET[k]} لهم رقم FIFA ID</div></div>
        ))}
      </div>
      <form action={importFifaIds} className="card">
        <h3>استيراد من ملف FIFA Connect</h3>
        <ol className="muted" style={{ fontSize: ".88rem", lineHeight: 1.9, marginTop: 0 }}>
          <li>من منصة FIFA Connect صدّر قائمة الأشخاص (أو الأندية) إلى Excel أو CSV.</li>
          <li>يجب أن يحتوي الملف عمود «FIFA ID»، ومعه الرقم الوطني أو رقم الجواز، أو الاسم مع تاريخ الميلاد.</li>
          <li>اضغط «فحص» أولًا لترى التقرير دون أي تعديل، ثم «حفظ الأرقام».</li>
        </ol>
        <div className="form f3">
          <Field label="نوع البيانات"><select name="target" defaultValue={rep?.target ?? "players"}>{Object.entries(TARGET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="الملف (xlsx أو csv)"><input type="file" name="file" accept=".xlsx,.csv" required /></Field>
          <Field label=" "><label className="check"><input type="checkbox" name="overwrite" /> استبدال الأرقام المختلفة الموجودة</label></Field>
        </div>
        <div className="btn-row">
          <Submit name="mode" value="check" className="btn btn-light">🔍 فحص فقط</Submit>
          <Submit name="mode" value="apply" className="btn btn-primary" confirm="حفظ أرقام FIFA ID للسجلات المطابقة؟">💾 فحص وحفظ الأرقام</Submit>
        </div>
      </form>
      {rep && (
        <div className="card table-wrap">
          <div className="card-head"><h3>آخر تقرير: {rep.file} — {TARGET[rep.target]} — {fmtDateTime(new Date(rep.at))} {rep.applied ? "(حُفظ)" : "(فحص فقط)"}</h3></div>
          <div className="tag-list" style={{ marginBottom: 10 }}>
            <Link className={`b ${!filter ? "b-blue" : "b-gray"}`} href="/registration/fifa-ids">الكل ({rep.rows.length})</Link>
            {Object.entries(rep.counts).map(([k, v]) => <Link key={k} className={`b ${filter === k ? "b-blue" : TONE[k] ?? "b-gray"}`} href={`/registration/fifa-ids?r=${k}`}>{resultLabel(k)} ({v})</Link>)}
          </div>
          <table className="t"><thead><tr><th>السطر</th><th>الاسم في الملف</th><th>FIFA ID</th><th>النتيجة</th><th>السجل في المنظومة</th></tr></thead>
            <tbody>{list.slice(0, 1000).map((r) => (
              <tr key={r.row}><td>{r.row}</td><td>{r.name}</td><td className="kbd">{r.fifa ?? "—"}</td><td><span className={`b ${TONE[r.result] ?? "b-gray"}`}>{resultLabel(r.result)}</span></td>
                <td>{r.match ? (r.href ? <Link href={r.href}>{r.match}</Link> : r.match) : "—"}</td></tr>))}</tbody></table>
          {list.length > 1000 && <p className="muted">يُعرض أول 1000 سطر.</p>}
        </div>
      )}
    </>
  );
}
