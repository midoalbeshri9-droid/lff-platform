import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cardTemplates } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { DEFAULT_FRONT } from "@/lib/cardDefault";
import { PageHead } from "@/components/ui";
import { CardDesigner } from "@/components/CardDesigner";

export default async function Designer({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("cards.design");
  const { id } = await params;
  let initial;
  if (id === "new") initial = { name: "قالب جديد", widthMm: 85.6, heightMm: 54, front: DEFAULT_FRONT, back: null, frontBg: null, backBg: null, isDefault: false };
  else {
    const [t] = await db.select().from(cardTemplates).where(eq(cardTemplates.id, Number(id)));
    if (!t) notFound();
    initial = { id: t.id, name: t.name, widthMm: t.widthMm, heightMm: t.heightMm, front: t.front, back: t.back, frontBg: t.frontBg, backBg: t.backBg, isDefault: t.isDefault };
  }
  return (
    <>
      <PageHead title="مصمم البطاقة" crumbs={[["قوالب البطاقات", "/registration/cards/templates"], [initial.name]]} />
      <CardDesigner initial={initial} />
    </>
  );
}
