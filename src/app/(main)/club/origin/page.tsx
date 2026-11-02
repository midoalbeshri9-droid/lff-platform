import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, clubs } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { REG_TYPE, ORIGIN } from "@/lib/labels";
import { fmtDateTime, fmtDate } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { respondOrigin } from "../actions";

export default async function Origin({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.origin");
  const sp = await searchParams;
  const rows = await db
    .select({ r: registrations, name: players.fullName, dob: players.dateOfBirth, to: clubs.name })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .where(and(eq(registrations.fromClubId, u.clubId)))
    .orderBy(desc(registrations.id)).limit(200);
  const pending = rows.filter((x) => x.r.originResponse === "PENDING" && x.r.status === "SUBMITTED");
  return (
    <>
      <PageHead title="طلبات انتقال لاعبي النادي" sub="أندية أخرى طلبت انتقال أو إعارة لاعبين مقيدين لديكم — الرد يصل للجنة القيد مباشرة" />
      <Flash sp={sp} />
      {pending.length === 0 && <div className="card"><Empty>لا توجد طلبات بانتظار ردكم</Empty></div>}
      {pending.map(({ r, name, dob, to }) => (
        <div className="card" key={r.id}>
          <div className="card-head"><h2>{name}</h2><span className="b b-indigo">{REG_TYPE[r.type]}</span></div>
          <p>إلى نادي <strong>{to}</strong> — تاريخ الميلاد {fmtDate(dob)} — أُرسل {fmtDateTime(r.submittedAt)}</p>
          <form action={respondOrigin} className="form">
            <input type="hidden" name="id" value={r.id} />
            <div className="field full"><label>ملاحظة / سبب الاعتراض</label><textarea name="reason" placeholder="مثال: اللاعب مرتبط بعقد ساري حتى ..." /></div>
            <div className="btn-row full">
              <Submit name="decision" value="agree" confirm="تأكيد الموافقة على الانتقال؟">✓ موافقة</Submit>
              <Submit name="decision" value="object" className="btn btn-danger" confirm="تأكيد الاعتراض؟">✗ اعتراض</Submit>
            </div>
          </form>
        </div>
      ))}
      <div className="card table-wrap">
        <h3>السجل</h3>
        <table className="t"><thead><tr><th>اللاعب</th><th>إلى</th><th>النوع</th><th>ردكم</th><th>التاريخ</th></tr></thead>
          <tbody>{rows.filter((x) => x.r.originResponse !== "PENDING").map(({ r, name, to }) => (
            <tr key={r.id}><td>{name}</td><td>{to}</td><td>{REG_TYPE[r.type]}</td><td><Badge v={ORIGIN[r.originResponse]} /></td><td>{fmtDateTime(r.originRespondedAt ?? r.createdAt)}</td></tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
