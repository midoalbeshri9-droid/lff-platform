import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Empty } from "@/components/ui";
import { Submit } from "@/components/Client";
import { revalidatePath } from "next/cache";

async function markAll() {
  "use server";
  const u = await requireUser();
  await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, u.id), eq(notifications.isRead, false)));
  revalidatePath("/notifications");
}

export default async function Notifications() {
  const u = await requireUser();
  const rows = await db.select().from(notifications).where(eq(notifications.userId, u.id)).orderBy(desc(notifications.at)).limit(200);
  return (
    <>
      <PageHead title="الإشعارات" actions={<form action={markAll}><Submit className="btn btn-light">تعليم الكل كمقروء</Submit></form>} />
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 && <Empty>لا توجد إشعارات</Empty>}
        {rows.map((n) => (
          <Link key={n.id} href={n.link ?? "#"} className={`notif ${n.isRead ? "" : "unread"}`}>
            <strong>{n.title}</strong>
            {n.body && <div className="muted" style={{ fontSize: ".86rem" }}>{n.body}</div>}
            <small>{fmtDateTime(n.at)}</small>
          </Link>
        ))}
      </div>
    </>
  );
}
