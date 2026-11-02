import { db } from "@/db";
import { settings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveSettings } from "../actions";

export default async function Settings({ searchParams }: { searchParams: SP }) {
  await requireUser("admin.settings");
  const sp = await searchParams;
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
    </>
  );
}
