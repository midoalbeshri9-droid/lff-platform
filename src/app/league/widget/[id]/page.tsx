import { notFound } from "next/navigation";
import { load, Tables, Fixtures, Scorers } from "@/components/LeagueParts";

export const dynamic = "force-dynamic";

/** نافذة قابلة للتضمين (iframe) في موقع الاتحاد أو أي موقع: الترتيب / المباريات / الهدافون — مثل Football Widgets في FCMS
 *  ?show=table|fixtures|scorers  &round=رقم الجولة */
export default async function Widget({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const x = await load(id);
  if (!x) notFound();
  const show = ["table", "fixtures", "scorers"].includes(sp.show ?? "") ? sp.show : "table";
  return (
    <div className="lg lg-embed">
      <div className="lg-embed-h"><img src="/img/logo-256.png" alt="" /><strong>{x.c.name}</strong><small>{x.season}</small></div>
      {show === "table" && <Tables id={id} />}
      {show === "fixtures" && <Fixtures id={id} round={sp.round} />}
      {show === "scorers" && <Scorers id={id} />}
      <a className="lg-embed-f" href={`/league/${id}`} target="_top">الاتحاد الليبي لكرة القدم — التفاصيل الكاملة ←</a>
    </div>
  );
}
