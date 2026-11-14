import { desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { officialExpenses, officials, matches, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { EXPENSE_KIND, EXPENSE_STATUS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Flash, Badge, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { reviewExpense } from "../../portal/expense-actions";

/** مصاريف الحكام والمراقبين المقدّمة من بواباتهم — الاعتماد يحوّلها مستحقًا في المالية */
export default async function Expenses({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("ref.view");
  const sp = await searchParams;
  const st = sp.status ?? "SUBMITTED";
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const rows = await db.select({ e: officialExpenses, name: officials.fullName, round: matches.round, kickoff: matches.kickoff, home: h.name, away: a.name }).from(officialExpenses)
    .innerJoin(officials, eq(officials.id, officialExpenses.officialId)).innerJoin(matches, eq(matches.id, officialExpenses.matchId))
    .innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .where(st === "ALL" ? undefined : inArray(officialExpenses.status, [st])).orderBy(desc(officialExpenses.id)).limit(300);
  const can = u.can("ref.approve");
  return (
    <>
      <PageHead title="مصاريف الحكام والمراقبين" sub="يقدّمها الحكم من بوابته لكل مباراة، والمعتمد يصبح مستحقًا له لدى اللجنة المالية" />
      <Flash sp={sp} />
      <div className="tag-list" style={{ marginBottom: 10 }}>{[["SUBMITTED", "بانتظار الاعتماد"], ["APPROVED", "المعتمدة"], ["REJECTED", "المرفوضة"], ["ALL", "الكل"]].map(([k, l]) => <a key={k} className={`b ${st === k ? "b-blue" : "b-gray"}`} href={`?status=${k}`}>{l}</a>)}</div>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد طلبات</Empty> : (
          <table className="t"><thead><tr><th>الحكم</th><th>المباراة</th><th>النوع</th><th>البيان</th><th className="num">المبلغ</th><th>الحالة</th>{can && st === "SUBMITTED" && <th>القرار</th>}</tr></thead>
            <tbody>{rows.map(({ e, name, round, kickoff, home, away }) => (
              <tr key={e.id}><td><strong>{name}</strong><div className="muted" style={{ fontSize: ".75rem" }}>{fmtDateTime(e.createdAt)}</div></td>
                <td>{home} × {away}<div className="muted" style={{ fontSize: ".75rem" }}>ج{round} — {fmtDateTime(kickoff)}</div></td>
                <td>{EXPENSE_KIND[e.kind]}</td><td>{e.description ?? "—"}{e.attachmentKey && <> <a href={fileUrl(e.attachmentKey)!} target="_blank">📎</a></>}{e.reviewNote && <div className="muted" style={{ fontSize: ".75rem" }}>{e.reviewNote}</div>}</td>
                <td className="num">{e.amount}</td><td><Badge v={EXPENSE_STATUS[e.status]} /></td>
                {can && st === "SUBMITTED" && <td>
                  <form action={reviewExpense} className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="number" step="0.01" name="amount" defaultValue={e.amount} style={{ width: 90 }} title="يمكن تعديل المبلغ" />
                    <input name="note" placeholder="ملاحظة / سبب الرفض" style={{ width: 140 }} />
                    <Submit name="decision" value="approve" className="btn btn-sm btn-primary">اعتماد</Submit>
                    <Submit name="decision" value="reject" className="btn btn-sm btn-danger">رفض</Submit>
                  </form></td>}
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
