import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contracts, registrations, players } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { expireContracts } from "@/lib/contracts";
import { CONTRACT_STATUS, PRO_LEVEL } from "@/lib/labels";
import { fmtDate, money } from "@/lib/util";
import { PageHead, Badge, Empty } from "@/components/ui";
import { Submit } from "@/components/Client";
import { createContract } from "./actions";

/** عقود لاعبي النادي المحترفين — تُكتب إلكترونيًا بنموذج الاتحاد الموحد */
export default async function ClubContracts() {
  const u = await requireClubUser("club.view");
  await expireContracts();
  const rows = await db.select({ c: contracts, name: players.fullName }).from(contracts).innerJoin(players, eq(players.id, contracts.playerId))
    .where(eq(contracts.clubId, u.clubId)).orderBy(desc(contracts.updatedAt));
  const season = await getCurrentSeason();
  // لاعبو الموسم الحالي (غير الهواة) بلا عقد
  const need = season ? await db.select({ regId: registrations.id, name: players.fullName, level: players.professionalLevel, status: registrations.status }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId)).leftJoin(contracts, eq(contracts.registrationId, registrations.id))
    .where(and(eq(registrations.clubId, u.clubId), eq(registrations.seasonId, season.id), inArray(registrations.status, ["APPROVED", "DRAFT", "NEEDS_CORRECTION", "SUBMITTED"]), isNull(contracts.id)))
    .orderBy(players.fullName) : [];
  const can = u.can("club.edit");
  return (
    <>
      <PageHead title="عقود اللاعبين المحترفين" sub="العقد يُكتب هنا بنموذج الاتحاد الموحد، ويُطبع للتوقيع، ثم تُرفع نسخته الموقّعة للاعتماد" />
      {can && (
        <div className="card">
          <h3>+ كتابة عقد جديد</h3>
          {need.length === 0 ? <p className="muted">لا يوجد لاعبون في قيد الموسم الحالي بلا عقد.</p> : (
            <form action={createContract} className="row">
              <select name="regId" required defaultValue="" style={{ minWidth: 320 }}>
                <option value="" disabled>اختر اللاعب ({need.length})</option>
                {need.map((x) => <option key={x.regId} value={x.regId}>{x.name} — {PRO_LEVEL[x.level] ?? x.level}</option>)}
              </select>
              <Submit className="btn btn-gold">إنشاء العقد</Submit>
            </form>
          )}
      <div className="card table-wrap">
        <h3>العقود ({rows.length})</h3>
        {rows.length === 0 ? <Empty>لا توجد عقود بعد — أنشئ عقدًا من القائمة أدناه.</Empty> : (
          <table className="t"><thead><tr><th>اللاعب</th><th>رقم العقد</th><th>المدة</th><th className="num">القيمة الإجمالية</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ c, name }) => (
              <tr key={c.id}><td><strong>{name}</strong></td><td className="kbd">{c.number ?? "—"}</td><td>{fmtDate(c.startDate)} ← {fmtDate(c.endDate)}</td>
                <td className="num">{c.totalValue ? (c.currency === "LYD" ? money(c.totalValue) : `${Number(c.totalValue).toLocaleString("en-US")} ${c.currency}`) : "—"}</td>
                <td><Badge v={CONTRACT_STATUS[c.status]} />{c.status === "RETURNED" && c.returnNote && <div className="danger-text" style={{ fontSize: ".8rem" }}>{c.returnNote}</div>}</td>
                <td><Link className="btn btn-sm btn-light" href={`/club/contracts/${c.id}`}>{["DRAFT", "RETURNED"].includes(c.status) ? "تحرير" : "عرض"}</Link></td></tr>))}</tbody></table>
        )}
      </div>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>تظهر هنا كل لاعبي النادي في قيد الموسم الحالي ممن ليس لهم عقد. العقد إلزامي للمحترف والهاوي تحت العقد.</p>
        </div>
      )}
    </>
  );
}
