import Link from "next/link";
import { db } from "@/db";
import { divisions } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth";
import type { DivCtx } from "@/lib/division";

/** تبويبات إدارة الدرجة — ومدير المنظومة يختار الدرجة التي يديرها */
export async function DivNav({ u, d, active }: { u: CurrentUser; d: DivCtx | null; active: "clubs" | "users" | "audit" }) {
  const qs = d?.admin ? `?d=${d.id}` : "";
  const tabs = [
    ...(u.can("div.clubs") ? [["clubs", "🏟 أندية الدرجة"] as const] : []),
    ...(u.can("div.users") ? [["users", "👥 الحسابات والصلاحيات"] as const, ["audit", "🧾 سجل عمليات الدرجة"] as const] : []),
  ];
  const all = u.role === "ADMIN" ? await db.select({ id: divisions.id, name: divisions.name }).from(divisions).orderBy(divisions.level) : [];
  return (
    <>
      {u.role === "ADMIN" && (
        <form method="get" className="card row" style={{ alignItems: "end" }}>
          <div className="field"><label>الدرجة (مدير المنظومة)</label>
            <select name="d" defaultValue={d?.id ?? ""}><option value="">— اختر —</option>{all.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <button className="btn btn-light">عرض</button>
        </form>
      )}
      {d && <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={`/division/${k}${qs}`} className={`tab ${k === active ? "active" : ""}`}>{l}</Link>)}</div>}
    </>
  );
}
