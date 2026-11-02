import { Fragment } from "react";
import { db } from "@/db";
import { rolePermissions, roleEnum } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { PERMISSION_GROUPS, DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { PageHead, Flash, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { savePermissions, resetPermissions } from "../actions";

export default async function Permissions({ searchParams }: { searchParams: SP }) {
  await requireUser("admin.permissions");
  const sp = await searchParams;
  const rows = await db.select().from(rolePermissions);
  const roles = roleEnum.enumValues;
  const has = (r: string, p: string) => rows.length ? rows.some((x) => x.role === r && x.permission === p) : (DEFAULT_PERMISSIONS as Record<string, string[]>)[r].includes(p);
  return (
    <>
      <PageHead title="مصفوفة الصلاحيات" sub="حدّد ما يستطيعه كل دور — التغيير يسري فورًا على كل المستخدمين"
        actions={<form action={resetPermissions}><Submit className="btn btn-light" confirm="استعادة الصلاحيات الافتراضية؟ ستُلغى تعديلاتك.">استعادة الافتراضي</Submit></form>} />
      <Flash sp={sp} />
      <form action={savePermissions} className="card">
        <div className="table-wrap">
          <table className="t perm-table">
            <thead><tr><th className="sticky-col">الصلاحية</th>{roles.map((r) => <th key={r} className="rot">{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g.group}>
                  <tr><td colSpan={roles.length + 1} style={{ background: "var(--green-l)", fontWeight: 700 }}>{g.group}</td></tr>
                  {g.items.map(([k, label]) => (
                    <tr key={k}>
                      <td className="sticky-col">{label}<div className="muted kbd" style={{ fontSize: ".72rem" }}>{k}</div></td>
                      {roles.map((r) => <td key={r}><input type="checkbox" name={`${r}:${k}`} defaultChecked={has(r, k)} /></td>)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt"><Submit confirm="حفظ مصفوفة الصلاحيات؟">💾 حفظ الصلاحيات</Submit></div>
      </form>
    </>
  );
}
