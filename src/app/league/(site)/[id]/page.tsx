import Link from "next/link";
import { notFound } from "next/navigation";
import { load, TABS, Tables, Fixtures, Scorers, Decisions } from "@/components/LeagueParts";

export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await load(Number((await params).id));
  return { title: c ? c.c.name : "المسابقة" };
}

export default async function LeaguePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const x = await load(id);
  if (!x) notFound();
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "table";
  return (
    <>
      <div className="lg-crumb"><Link href="/league">المسابقات</Link> / {x.c.name}</div>
      <h1 className="lg-h1">{x.c.name} <small className="muted">الموسم {x.season}</small></h1>
      <nav className="lg-tabs">{TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={k === tab ? "on" : ""}>{l}</Link>)}</nav>
      {tab === "table" && <Tables id={id} />}
      {tab === "fixtures" && <Fixtures id={id} round={sp.round} />}
      {tab === "scorers" && <Scorers id={id} />}
      {tab === "decisions" && <Decisions id={id} />}
    </>
  );
}
