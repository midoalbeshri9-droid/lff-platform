"use server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { stadiums, stadiumInspections, matches } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { attempt, str, req, int, bool, UserError, today } from "@/lib/util";

export async function saveStadium(f: FormData) {
  const u = await requireUser("comp.stadiums");
  const id = int(f, "id");
  await attempt(id ? `/competitions/stadiums/${id}` : "/competitions/stadiums", async () => {
    const data = {
      name: req(f, "name", "اسم الملعب"), city: str(f, "city"), capacity: int(f, "capacity"), clubId: int(f, "clubId"),
      surface: str(f, "surface") ?? "NATURAL", hasLights: bool(f, "hasLights"), approvalUntil: str(f, "approvalUntil"), notes: str(f, "notes"),
    };
    const [dup] = await db.select({ id: stadiums.id }).from(stadiums).where(eq(stadiums.name, data.name));
    if (dup && dup.id !== id) throw new UserError("يوجد ملعب بنفس الاسم");
    if (id) await db.update(stadiums).set(data).where(eq(stadiums.id, id));
    else await db.insert(stadiums).values(data);
    await audit(u, id ? "تعديل ملعب" : "إضافة ملعب", "Stadium", id, data.name);
    return "تم حفظ الملعب";
  });
}

export async function addInspection(f: FormData) {
  const u = await requireUser("comp.stadiums");
  const stadiumId = int(f, "stadiumId")!;
  await attempt(`/competitions/stadiums/${stadiumId}`, async () => {
    const file = f.get("file") as File | null;
    const fileKey = file && file.size ? (await saveUpload(file, "stadiums")).key : null;
    const result = req(f, "result", "نتيجة المعاينة");
    const date = str(f, "date") ?? today();
    await db.insert(stadiumInspections).values({ stadiumId, date, result, inspector: str(f, "inspector"), notes: str(f, "notes"), fileKey, createdBy: u.fullName });
    const until = str(f, "approvalUntil");
    await db.update(stadiums).set({
      lastInspection: date, ...(until ? { approvalUntil: until } : {}),
      ...(result === "FAIL" ? { status: "SUSPENDED", suspensionReason: `معاينة غير صالحة بتاريخ ${date}`, suspendedUntil: null } : { status: result === "PASS" ? "APPROVED" : "CONDITIONAL" }),
    }).where(eq(stadiums.id, stadiumId));
    await audit(u, "معاينة ملعب", "Stadium", stadiumId, { result, date });
    return result === "FAIL" ? "سُجلت المعاينة وأُوقف الملعب" : "سُجلت المعاينة";
  });
}

/** إيقاف الملعب بقرار (أو إغلاقه) وإبلاغ الأندية التي لها مباريات قادمة عليه */
export async function suspendStadium(f: FormData) {
  const u = await requireUser("comp.stadiums");
  const id = int(f, "id")!;
  await attempt(`/competitions/stadiums/${id}`, async () => {
    const status = f.get("close") === "1" ? "CLOSED" : "SUSPENDED";
    const reason = req(f, "reason", "سبب الإيقاف");
    await db.update(stadiums).set({ status, suspensionReason: reason, suspendedUntil: str(f, "until"), decisionRef: str(f, "decisionRef") }).where(eq(stadiums.id, id));
    const up = await db.select().from(matches).where(and(eq(matches.stadiumId, id), eq(matches.status, "SCHEDULED"), gte(matches.kickoff, new Date())));
    for (const m of up) await notifyClub(m.homeClubId, "إيقاف الملعب المعتمد لمباراتكم", reason, `/club/matches/${m.id}`);
    await audit(u, status === "CLOSED" ? "إغلاق ملعب" : "إيقاف ملعب", "Stadium", id, reason);
    return `تم ${status === "CLOSED" ? "إغلاق" : "إيقاف"} الملعب${up.length ? ` — ${up.length} مباراة قادمة تحتاج نقلًا (تظهر في تقويم التعارضات)` : ""}`;
  });
}

export async function reinstateStadium(f: FormData) {
  const u = await requireUser("comp.stadiums");
  const id = int(f, "id")!;
  await attempt(`/competitions/stadiums/${id}`, async () => {
    await db.update(stadiums).set({ status: "APPROVED", suspensionReason: null, suspendedUntil: null }).where(eq(stadiums.id, id));
    await audit(u, "إعادة اعتماد ملعب", "Stadium", id);
    return "أُعيد اعتماد الملعب";
  });
}
