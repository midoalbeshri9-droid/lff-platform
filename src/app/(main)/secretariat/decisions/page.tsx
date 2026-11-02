import { redirect } from "next/navigation";
import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { decisions, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { committeeOf } from "@/lib/secretariat";
import { COMMITTEE, DECISION_STATUS } from "@/lib/labels";
import { today } from "@/lib/util";
import { PageHead, Flash, Empty, Options, type SP } from "@/components/ui";
import { DecisionCard, DecisionForm } from "./DecisionParts";

export default async function Decisions({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const mine = committeeOf(u.role);
  const canAll = u.can("sec.view");
  if (!canAll && !mine) redirect("/denied");
  const assignee = canAll ? (sp.mine && mine ? mine : sp.assignee) : mine;
  const rows = await db.select().from(decisions).where(and(
    assignee ? eq(decisions.assignee, assignee) : undefined, sp.status ? eq(decisions.status, sp.status) : undefined,
    sp.late ? and(lt(decisions.dueDate, today()), notInArray(decisions.status, ["DONE", "CANCELLED"])) : undefined,
    sp.open ? inArray(decisions.status, ["PENDING", "IN_PROGRESS"]) : undefined,
  )).orderBy(desc(decisions.date), desc(decisions.id)).limit(300);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  return (
    <>
      <PageHead title={canAll ? "القرارات ومتابعة التنفيذ" : `القرارات المكلفة بها ${COMMITTEE[mine!]}`} sub="قرارات مجلس الإدارة واللجان، والجهة المكلفة، وموعد التنفيذ وسجل المتابعة" />
      <Flash sp={sp} />
      <form className="filters">
        {canAll && <div className="field"><label>الجهة المكلفة</label><select name="assignee" defaultValue={sp.assignee ?? ""}><option value="">الكل</option><Options map={COMMITTEE} /></select></div>}
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option>{Object.entries(DECISION_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></div>
        <label className="check"><input type="checkbox" name="late" value="1" defaultChecked={!!sp.late} /> المتأخرة فقط</label>
        <button className="btn btn-light">عرض</button>
      </form>
      {rows.length === 0 ? <div className="card"><Empty>لا قرارات</Empty></div> :
        rows.map((d) => <DecisionCard key={d.id} d={d} canFollow={u.can("sec.manage") || d.assignee === mine} canCancel={u.can("sec.manage")} back="/secretariat/decisions" />)}
      {u.can("sec.manage") && <details className="card"><summary>+ قرار مستقل (بدون محضر)</summary><DecisionForm clubs={cl} /></details>}
    </>
  );
}
