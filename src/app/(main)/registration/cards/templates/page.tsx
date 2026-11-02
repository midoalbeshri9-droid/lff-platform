import Link from "next/link";
import { db } from "@/db";
import { cardTemplates } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { SAMPLE } from "@/lib/cardFields";
import { PageHead, Flash, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { CardFace } from "@/components/CardFace";
import { deleteCardTemplate } from "../../actions";

export default async function CardTemplates({ searchParams }: { searchParams: SP }) {
  await requireUser("cards.design");
  const sp = await searchParams;
  const rows = await db.select().from(cardTemplates).orderBy(cardTemplates.name);
  return (
    <>
      <PageHead title="قوالب بطاقات اللاعبين" sub="صمّم البطاقة بالبيانات التي تريدها — مقاس CR80 لطابعة Fargo DTC1250e"
        actions={<Link className="btn btn-primary" href="/registration/cards/templates/new">+ قالب جديد</Link>} />
      <Flash sp={sp} />
      <div className="grid g2">
        {rows.map((t) => (
          <div key={t.id} className="card">
            <div className="card-head"><h3>{t.name}</h3>{t.isDefault && <span className="b b-green">الافتراضي</span>}</div>
            <div className="canvas-wrap" style={{ padding: 12 }}>
              <CardFace els={t.front} w={t.widthMm} h={t.heightMm} bg={t.frontBg ? `/api/files/${t.frontBg}` : null} data={SAMPLE} scale={3} />
            </div>
            <div className="btn-row mt">
              <Link className="btn btn-light btn-sm" href={`/registration/cards/templates/${t.id}`}>✎ تعديل التصميم</Link>
              <form action={deleteCardTemplate}><input type="hidden" name="id" value={t.id} /><Submit className="btn btn-ghost btn-sm" confirm="حذف القالب؟">حذف</Submit></form>
              {t.back && t.back.length > 0 && <span className="b b-indigo">وجهان</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
