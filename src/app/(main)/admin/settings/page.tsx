import { db } from "@/db";
import { settings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveSettings, save2faRoles } from "../actions";
import { required2faRoles } from "@/lib/totp";
import { ROLE_LABEL } from "@/lib/labels";

export default async function Settings({ searchParams }: { searchParams: SP }) {
  await requireUser("admin.settings");
  const sp = await searchParams;
  const r2 = await required2faRoles();
  const s = Object.fromEntries((await db.select().from(settings)).map((x) => [x.key, x.value]));
  return (
    <>
      <PageHead title="الإعدادات العامة" />
      <Flash sp={sp} />
      <form action={saveSettings} className="card form" style={{ maxWidth: 760 }}>
        <Field label="اسم الاتحاد (يظهر في الترويسة والبطاقات)"><input type="text" name="federation_name" defaultValue={s.federation_name ?? "الاتحاد الليبي لكرة القدم"} /></Field>
        <Field label="الاسم بالإنجليزية"><input type="text" name="federation_name_en" dir="ltr" defaultValue={s.federation_name_en ?? "Libyan Football Federation"} /></Field>
        <div className="full"><Submit>حفظ</Submit></div>
      </form>
      <form action={save2faRoles} className="card" style={{ maxWidth: 760 }}>
        <h2>🔐 الأدوار الملزمة بالتحقق بخطوتين</h2>
        <p className="muted">التحقق بخطوتين اختياري لكل المستخدمين (يفعّله كل شخص من «حسابي»). إن اخترت أدوارًا هنا يصبح إلزاميًا لأصحابها: لا يستخدمون المنظومة قبل ربط هواتفهم. اتركها كلها فارغة ليبقى اختياريًا للجميع.</p>
        <div className="grid g3" style={{ gap: ".3rem" }}>{Object.entries(ROLE_LABEL).map(([k, l]) => (
          <label key={k} className="check"><input type="checkbox" name="r2fa" value={k} defaultChecked={r2.includes(k as never)} /> {l}</label>))}</div>
        <div className="mt"><Submit>حفظ</Submit></div>
      </form>
    </>
  );
}
