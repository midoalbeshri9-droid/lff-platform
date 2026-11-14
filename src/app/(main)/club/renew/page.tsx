import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, seasons } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { PRO_LEVEL } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Empty, type SP } from "@/components/ui";
import { Submit, CheckAll } from "@/components/Client";
import { bulkRenew } from "./actions";

/** التجديد الجماعي للاعبي النادي في الموسم السابق */
export default async function BulkRenew({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const prev = season ? await db.select({ pid: registrations.playerId, name: players.fullName, card: players.cardNo, dob: players.dateOfBirth, level: players.professionalLevel, photo: players.photoKey, season: seasons.name, start: seasons.startDate, clubId: registrations.clubId })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .where(and(eq(registrations.status, "APPROVED"), ne(registrations.seasonId, season.id), eq(players.status, "ACTIVE"), inArray(registrations.playerId,
      db.select({ id: registrations.playerId }).from(registrations).where(eq(registrations.clubId, u.clubId)))))
    .orderBy(desc(seasons.startDate)) : [];
  const now = season ? new Set((await db.select({ pid: registrations.playerId }).from(registrations)
    .where(and(eq(registrations.seasonId, season.id), inArray(registrations.status, ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "APPROVED"])))).map((r) => r.pid)) : new Set<number>();
  const seen = new Set<number>();
  const list = prev.filter((r) => { if (seen.has(r.pid)) return false; seen.add(r.pid); return true; }) // آخر قيد معتمد لكل لاعب
    .filter((r) => r.clubId === u.clubId && !now.has(r.pid)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return (
    <>
      <PageHead title="التجديد الجماعي" sub={`لاعبو النادي في المواسم السابقة غير المجدَّد لهم في الموسم ${season?.name ?? ""}`} crumbs={[["لاعبو النادي", "/club/players"], ["التجديد الجماعي"]]} />
      <Flash sp={sp} />
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>يُنشأ طلب تجديد لكل لاعب تختاره، وتُنقل إليه مستنداته المعتمدة من قيده السابق. الطلب المكتمل (الصورة والمستندات والعقد الساري للمحترف) يُرسل للجنة مباشرة، والناقص يبقى مسودة في «الطلبات» لتستكمله — كما في FIFA Connect.</p>
        {list.length === 0 ? <Empty>لا يوجد لاعبون بحاجة للتجديد</Empty> : (
          <form action={bulkRenew}>
            <div className="table-wrap"><table className="t"><thead><tr><th><CheckAll name="playerId" /></th><th>اللاعب</th><th>رقم البطاقة</th><th>الميلاد</th><th>المستوى</th><th>آخر موسم</th><th>الصورة</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.pid}><td><input type="checkbox" name="playerId" value={r.pid} /></td><td>{r.name}</td><td className="kbd">{r.card ?? "—"}</td><td>{fmtDate(r.dob)}</td><td>{PRO_LEVEL[r.level] ?? r.level}</td><td>{r.season}</td><td>{r.photo ? "✓" : <span className="danger-text">ناقصة</span>}</td></tr>))}</tbody></table></div>
            {u.can("club.edit") && <div className="btn-row mt">
              {u.can("club.submit") && <label className="check"><input type="checkbox" name="submit" defaultChecked /> إرسال الطلبات المكتملة للجنة مباشرة</label>}
              <Submit confirm="إنشاء طلبات تجديد للاعبين المحددين؟">🔁 تجديد المحددين</Submit>
            </div>}
          </form>
        )}
      </div>
    </>
  );
}
