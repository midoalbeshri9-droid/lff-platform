"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { passportRecords } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { guard, inScopePlayer } from "@/lib/scope";
import { attempt, str, int, req, UserError, today } from "@/lib/util";
import { audit } from "@/lib/audit";
import { playerPassport } from "@/lib/passport";

/** إضافة سجل تاريخي لجواز اللاعب (نادٍ سبق المنظومة أو خارج ليبيا) */
export async function addPassportRecord(f: FormData) {
  const u = await requireUser("reg.edit");
  const playerId = int(f, "playerId")!;
  await attempt(`/registration/players/${playerId}`, async () => {
    guard(await inScopePlayer(u, playerId));
    const startDate = req(f, "startDate", "تاريخ البداية"), endDate = req(f, "endDate", "تاريخ النهاية");
    if (endDate <= startDate) throw new UserError("تاريخ النهاية يجب أن يكون بعد البداية");
    if (endDate > today()) throw new UserError("لا يمكن إضافة سجل لفترة مستقبلية");
    const pp = await playerPassport(playerId);
    if (pp.from12 && endDate < pp.from12) throw new UserError("الجواز يبدأ من عيد ميلاد اللاعب الثاني عشر");
    const clash = pp.rows.find((r) => startDate < (r.to ?? "9999") && endDate > r.from);
    if (clash) throw new UserError(`الفترة تتداخل مع سجل ${clash.club} (${clash.from} ← ${clash.to ?? "الآن"})`);
    const level = str(f, "level");
    await db.insert(passportRecords).values({
      playerId, clubName: req(f, "clubName", "اسم النادي"), country: str(f, "country") ?? "ليبيا",
      level: level && ["AMATEUR", "AMATEUR_CONTRACT", "PROFESSIONAL"].includes(level) ? level : null,
      isLoan: f.get("isLoan") === "on", startDate, endDate, notes: str(f, "notes"), createdBy: u.fullName,
    });
    await audit(u, "إضافة سجل لجواز اللاعب", "Player", playerId);
    return "أُضيف السجل إلى جواز اللاعب";
  });
}

export async function deletePassportRecord(f: FormData) {
  const u = await requireUser("reg.edit");
  const playerId = int(f, "playerId")!;
  await attempt(`/registration/players/${playerId}`, async () => {
    guard(await inScopePlayer(u, playerId));
    await db.delete(passportRecords).where(and(eq(passportRecords.id, int(f, "id")!), eq(passportRecords.playerId, playerId)));
    return "حُذف السجل";
  });
}
