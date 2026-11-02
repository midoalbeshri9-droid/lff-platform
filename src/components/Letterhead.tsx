import { db } from "@/db";
import { settings } from "@/db/schema";

export async function Letterhead({ sub, subEn }: { sub: string; subEn: string }) {
  const s = Object.fromEntries((await db.select().from(settings)).map((x) => [x.key, x.value]));
  return (
    <div className="letterhead">
      <div className="ar">{s.federation_name ?? "الاتحاد الليبي لكرة القدم"}<br /><span style={{ fontWeight: 500 }}>{sub}</span></div>
      <img src="/img/logo-256.png" alt="" />
      <div className="en">{s.federation_name_en ?? "Libyan Football Federation"}<br /><span style={{ fontWeight: 500 }}>{subEn}</span></div>
    </div>
  );
}
