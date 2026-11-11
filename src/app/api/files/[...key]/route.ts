import { eq, and, or } from "drizzle-orm";
import { db } from "@/db";
import { registrationDocuments, registrations, players, correspondence, decisions, archiveDocs, archiveVersions, staff, reportFiles } from "@/db/schema";
import { inScopeMatch } from "@/lib/scope";
import { ROLE_COMMITTEE } from "@/lib/labels";
import { canSeeDoc } from "@/lib/archive";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { readObject, mimeOf } from "@/lib/storage";

/** تنزيل الملفات مع فحص الصلاحية: النادي يرى ملفات لاعبيه فقط */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const key = (await params).key.map(decodeURIComponent).join("/");
  if (key.includes("..")) return new Response("bad", { status: 400 });

  let allowed = false;
  let dispName: string | null = null;
  if (key.startsWith("archive/")) {
    // الأرشيف: حسب درجة السرية، مع تسجيل كل اطلاع
    const [d] = await db.select().from(archiveDocs).where(eq(archiveDocs.fileKey, key));
    const [v] = d ? [] : await db.select({ docId: archiveVersions.docId }).from(archiveVersions).where(eq(archiveVersions.fileKey, key));
    const doc = d ?? (v ? (await db.select().from(archiveDocs).where(eq(archiveDocs.id, v.docId)))[0] : undefined);
    if (!doc || !canSeeDoc(u, doc) || (doc.isDeleted && !u.can("archive.secret"))) return new Response("forbidden", { status: 403 });
    await audit(u, d ? "اطلاع على وثيقة" : "اطلاع على نسخة سابقة", "ArchiveDoc", doc.id, doc.number);
    dispName = (d ? doc.fileName : null) ?? `${doc.number.replace(/\//g, "-")}.${key.split(".").pop()}`;
    allowed = true;
  } else if (key.startsWith("cards/")) allowed = true; // خلفيات البطاقات
  else if (key.startsWith("regulations/")) allowed = true; // اللوائح المعتمدة متاحة لكل المستخدمين
  else if (key.startsWith("reports/")) {
    // مرفقات تقارير الحكام والمراقبين: سرية للجنة المسابقات وكاتب التقرير فقط
    const [x] = await db.select({ off: reportFiles.officialId, matchId: reportFiles.matchId }).from(reportFiles).where(eq(reportFiles.fileKey, key));
    allowed = !!x && ((u.isOfficial && u.officialId === x.off) || (!u.isClub && !u.isOfficial && u.canAny("comp.reports", "comp.reports.view") && (await inScopeMatch(u, x.matchId))));
  }
  else if (!u.isClub && !u.isOfficial && key.startsWith("correspondence/")) {
    // المراسلات: الأمانة العامة، أو اللجنة المختصة بالمراسلة
    if (u.can("sec.view")) allowed = true;
    else {
      const [c] = await db.select({ committee: correspondence.committee }).from(correspondence).where(eq(correspondence.fileKey, key));
      allowed = !!c?.committee && c.committee === ROLE_COMMITTEE[u.role];
    }
  }
  else if (!u.isClub && !u.isOfficial && key.startsWith("meetings/")) allowed = u.can("sec.view"); // محاضر الاجتماعات للأمانة العامة
  else if (!u.isClub && !u.isOfficial && /^docs\/\d+\/contracts\//.test(key)) allowed = u.can("reg.contracts"); // العقود الموقّعة فيها القيم المالية
  else if (!u.isClub && !u.isOfficial) allowed = u.canAny("reg.view", "comp.view", "cards.print", "ref.view", "sec.view", "fin.view");
  else if (u.isClub) {
    if (key.startsWith("correspondence/") || key.startsWith("decisions/")) {
      const [c] = await db.select({ id: correspondence.id }).from(correspondence).where(and(eq(correspondence.fileKey, key), eq(correspondence.clubId, u.clubId!), eq(correspondence.visibleToClub, true)));
      const [d] = c ? [c] : await db.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.fileKey, key), eq(decisions.clubId, u.clubId!)));
      allowed = !!(c || d);
    } else if (key.startsWith(`docs/${u.clubId}/`)) {
      // مجلد مستندات النادي: كل ما فيه رُفع للنادي نفسه (طلبات القيد، الإداريون، طلبات التأجيل، ملف اللاعب)
      allowed = true;
    } else if (key.startsWith("photos/")) {
      const [p] = await db.select({ id: players.id }).from(players)
        .leftJoin(registrations, eq(registrations.playerId, players.id))
        .where(and(eq(players.photoKey, key), or(eq(registrations.clubId, u.clubId!), eq(registrations.fromClubId, u.clubId!), eq(players.createdByClubId, u.clubId!))))
        .limit(1);
      // صور الإداريين والجهاز الفني للنادي نفسه
      const [s] = p ? [p] : await db.select({ id: staff.id }).from(staff).where(and(eq(staff.photoKey, key), eq(staff.clubId, u.clubId!))).limit(1);
      allowed = !!s;
    }
  }
  if (!allowed) return new Response("forbidden", { status: 403 });
  const buf = await readObject(key);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": mimeOf(key), "Cache-Control": key.startsWith("archive/") ? "private, no-store" : "private, max-age=3600", "X-Content-Type-Options": "nosniff",
      ...(dispName ? { "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(dispName)}` } : {}) },
  });
}
