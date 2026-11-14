"use server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, registrationDocuments, seasons } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { audit, notifyStaff } from "@/lib/audit";
import { attempt, UserError } from "@/lib/util";
import { getCurrentSeason, categoryFor, logEvent, missingDocs, openWindow, needsContract, assertForeignQuota } from "@/lib/registration";
import { clubBlockReason } from "@/lib/finance";
import { runningContract } from "@/lib/contracts";

const REG_ROLES = ["REG_HEAD", "REG_STAFF"] as const;

/** التجديد الجماعي (Bulk Renewal) كما في FIFA Connect: طلب تجديد لكل لاعب محدد، مع نقل مستنداته المعتمدة من قيده السابق،
 *  ويُرسل تلقائيًا كل طلب مكتمل؛ والناقص يبقى مسودة ليُستكمل */
export async function bulkRenew(f: FormData) {
  const u = await requireClubUser("club.edit");
  const ids = f.getAll("playerId").map(Number).filter(Boolean);
  const submit = f.get("submit") === "on" && u.can("club.submit");
  await attempt("/club/renew", async () => {
    if (!ids.length) throw new UserError("اختر لاعبًا واحدًا على الأقل");
    if (ids.length > 200) throw new UserError("الحد 200 لاعب في الدفعة");
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي");
    const w = submit ? await openWindow(season.id, u.clubId) : null;
    const block = submit ? await clubBlockReason(u.clubId) : null;
    let created = 0, sent = 0;
    const drafts: string[] = [];
    for (const pid of ids) {
      const [p] = await db.select().from(players).where(eq(players.id, pid));
      if (!p || p.status !== "ACTIVE") continue;
      const [open] = await db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.playerId, pid), eq(registrations.seasonId, season.id), inArray(registrations.status, ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "APPROVED"])));
      if (open) continue;
      const [last] = await db.select({ r: registrations }).from(registrations).innerJoin(seasons, eq(seasons.id, registrations.seasonId))
        .where(and(eq(registrations.playerId, pid), eq(registrations.status, "APPROVED"))).orderBy(desc(seasons.startDate)).limit(1);
      if (!last || last.r.clubId !== u.clubId) continue; // التجديد للاعبي النادي فقط — غيرهم انتقال
      const cat = await categoryFor(p.dateOfBirth, season.startDate);
      const regId = await db.transaction(async (tx) => {
        const [r] = await tx.insert(registrations).values({ playerId: pid, clubId: u.clubId, seasonId: season.id, type: "RENEWAL", status: "DRAFT", categoryId: cat?.id, shirtNumber: last.r.shirtNumber }).returning();
        // المستندات المعتمدة في القيد السابق تبقى (كما في FIFA Connect عند التجديد)
        const old = await tx.select().from(registrationDocuments).where(and(eq(registrationDocuments.registrationId, last.r.id), eq(registrationDocuments.status, "APPROVED")));
        if (old.length) await tx.insert(registrationDocuments).values(old.map((d) => ({ registrationId: r.id, documentTypeId: d.documentTypeId, fileKey: d.fileKey, originalName: d.originalName, mime: d.mime, size: d.size, status: "APPROVED" as const, uploadedBy: `${u.fullName} (منقول من القيد ${last.r.number ?? last.r.id})`, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt })));
        await logEvent(tx, r.id, u.fullName, "إنشاء طلب تجديد (جماعي)", old.length ? `نُقل ${old.length} مستند من القيد السابق` : null);
        return r.id;
      });
      created++;
      // إرسال تلقائي إن اكتمل كل شيء
      let reason = "";
      if (!submit) reason = "لم يُطلب الإرسال";
      else if (block) reason = block;
      else if (!w) reason = "فترة القيد مغلقة";
      else if (!p.photoKey) reason = "الصورة";
      else {
        const miss = await missingDocs(regId);
        if (miss.length) reason = miss.map((m) => m.name).join("، ");
        else if (needsContract(p.professionalLevel) && !(await runningContract(pid, u.clubId))) reason = "عقد ساري";
        else { try { await assertForeignQuota(regId); } catch (e) { reason = (e as Error).message; } }
      }
      if (!reason) {
        await db.transaction(async (tx) => {
          await tx.update(registrations).set({ status: "SUBMITTED", submittedAt: new Date(), submittedBy: u.fullName, updatedAt: new Date() }).where(eq(registrations.id, regId));
          await logEvent(tx, regId, u.fullName, "إرسال إلى لجنة القيد (تجديد جماعي)", w!.label);
        });
        sent++;
      } else drafts.push(`${p.fullName} (${reason})`);
    }
    if (sent) await notifyStaff([...REG_ROLES], `تجديد جماعي — ${u.clubName}`, `${sent} طلب تجديد بانتظار المراجعة`, "/registration/requests", { clubId: u.clubId });
    await audit(u, "تجديد جماعي", "Registration", 0, { created, sent });
    if (!created) throw new UserError("لم يُنشأ أي طلب — اللاعبون المختارون لديهم طلبات أو قيود في الموسم الحالي");
    return `أُنشئ ${created} طلب تجديد، وأُرسل ${sent} مكتملًا للجنة${drafts.length ? ` — بقي ${drafts.length} مسودة تحتاج استكمالًا: ${drafts.slice(0, 8).join("؛ ")}${drafts.length > 8 ? " ..." : ""}` : ""}`;
  });
}
