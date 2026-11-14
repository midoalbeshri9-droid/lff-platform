"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clubCategories } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { guard, inScopeClub } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { attempt, int, req, str, UserError } from "@/lib/util";
import { CLUB_CATEGORY } from "@/lib/labels";

/** سجل تصنيف النادي لتعويضات التدريب (FIFA RSTP) — كما في FIFA Connect: Club Category */
export async function addClubCategory(f: FormData) {
  const u = await requireUser("reg.edit");
  await attempt("/registration/club-categories", async () => {
    const clubId = int(f, "clubId")!;
    guard(await inScopeClub(u, clubId));
    const category = String(f.get("category"));
    if (!CLUB_CATEGORY[category]) throw new UserError("اختر التصنيف");
    const validFrom = req(f, "validFrom", "تاريخ السريان");
    const [dup] = await db.select({ id: clubCategories.id }).from(clubCategories).where(and(eq(clubCategories.clubId, clubId), eq(clubCategories.validFrom, validFrom)));
    if (dup) throw new UserError("يوجد تصنيف بنفس تاريخ السريان لهذا النادي");
    await db.insert(clubCategories).values({ clubId, category, validFrom, notes: str(f, "notes"), createdBy: u.fullName });
    await audit(u, "تصنيف نادٍ للتدريب", "Club", clubId, { category, validFrom });
    return "حُفظ التصنيف";
  });
}

export async function deleteClubCategory(f: FormData) {
  const u = await requireUser("reg.edit");
  await attempt("/registration/club-categories", async () => {
    const [r] = await db.select().from(clubCategories).where(eq(clubCategories.id, int(f, "id")!));
    if (!r) throw new UserError("غير موجود");
    guard(await inScopeClub(u, r.clubId));
    await db.delete(clubCategories).where(eq(clubCategories.id, r.id));
    return "حُذف";
  });
}
