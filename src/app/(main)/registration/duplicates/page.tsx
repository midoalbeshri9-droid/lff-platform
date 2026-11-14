import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { duplicateGroups } from "@/lib/merge";
import { fmtDate } from "@/lib/util";
import { PageHead, Empty, Flash, type SP } from "@/components/ui";

/** السجلات المحتمل تكرارها (نفس الاسم وتاريخ الميلاد) — دمجها كما في FIFA Connect */
export default async function Duplicates({ searchParams }: { searchParams: SP }) {
  await requireUser("reg.edit");
  const sp = await searchParams;
  const groups = await duplicateGroups();
  return (
    <>
      <PageHead title="السجلات المكررة" sub="لاعبون بنفس الاسم وتاريخ الميلاد — تحقق أنهم نفس الشخص قبل الدمج، فالدمج لا يمكن التراجع عنه" crumbs={[["سجل اللاعبين", "/registration/players"], ["المكررون"]]} />
      <Flash sp={sp} />
      <div className="card table-wrap">
        {groups.length === 0 ? <Empty>لا توجد سجلات مكررة محتملة 👍</Empty> : (
          <table className="t"><thead><tr><th>الاسم</th><th>تاريخ الميلاد</th><th>السجلات</th><th></th></tr></thead>
            <tbody>{groups.map((g) => (
              <tr key={g[0].id}><td><strong>{g[0].name}</strong></td><td>{fmtDate(g[0].dob)}</td>
                <td>{g.map((p) => <div key={p.id}><Link href={`/registration/players/${p.id}`}>#{p.id}</Link> {p.card && <span className="kbd">{p.card}</span>} {p.fifa && <span className="muted">FIFA {p.fifa}</span>}</div>)}</td>
                <td><Link className="btn btn-sm btn-light" href={`/registration/duplicates/merge?master=${g[0].id}&dup=${g[1].id}`}>🔀 مقارنة ودمج</Link></td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
