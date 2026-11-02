"use server";
import { and, eq, gte, or } from "drizzle-orm";
import { db } from "@/db";
import { stadiums, stadiumInspections, matches, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub, notifyRoles } from "@/lib/audit";
import { stadiumBlock } from "@/lib/stadiums";
import { saveUpload } from "@/lib/storage";
import { attempt, str, req, int, bool, UserError, today } from "@/lib/util";

export async function saveStadium(f: FormData) {
  const u = await requireUser("comp.stadiums");
  const id = int(f, "id");
  await attempt(id ? `/competitions/stadiums/${id}` : "/competitions/stadiums", async () => {
    const data = {
      name: req(f, "name", "اسم الملعب"), city: str(f, "city"), capacity: int(f, "capacity"),
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
    // إبلاغ الأندية التي اختارته ملعبًا أساسيًا أو احتياطيًا
    const users = await db.select({ id: clubs.id }).from(clubs).where(or(eq(clubs.mainStadiumId, id), eq(clubs.backupStadiumId, id)));
    for (const c of users) await notifyClub(c.id, "إيقاف أحد ملاعبكم المعتمدة", reason, "/club/stadiums");
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

/** م26: الملعب الأساسي والاحتياطي للنادي — يحددهما النادي من بوابته، أو لجنة المسابقات */
export async function setClubStadiums(f: FormData) {
  const u = await requireUser("club.edit", "comp.stadiums");
  const clubId = u.isClub ? u.clubId! : int(f, "clubId")!;
  const back = u.isClub ? "/club/stadiums" : "/competitions/stadiums#clubs";
  await attempt(back, async () => {
    const main = int(f, "mainStadiumId"), backup = int(f, "backupStadiumId");
    if (!main) throw new UserError("اختر الملعب الأساسي");
    if (main === backup) throw new UserError("الملعب الاحتياطي يجب أن يختلف عن الأساسي (م26)");
    const st = await db.select().from(stadiums);
    for (const sid of [main, backup].filter(Boolean) as number[]) {
      const s = st.find((x) => x.id === sid);
      if (!s) throw new UserError("ملعب غير موجود");
      const b = stadiumBlock(s, today());
      if (b && u.isClub) throw new UserError(b);
    }
    await db.update(clubs).set({ mainStadiumId: main, backupStadiumId: backup ?? null, stadium: st.find((x) => x.id === main)?.name ?? null }).where(eq(clubs.id, clubId));
    const [c] = await db.select({ n: clubs.name }).from(clubs).where(eq(clubs.id, clubId));
    if (u.isClub) await notifyRoles(["COMP_HEAD", "COMP_STAFF"], `تحديد ملاعب نادي ${c?.n}`, `الأساسي: ${st.find((x) => x.id === main)?.name} — الاحتياطي: ${st.find((x) => x.id === backup)?.name ?? "—"}`, "/competitions/stadiums#clubs");
    else await notifyClub(clubId, "اعتمدت لجنة المسابقات ملاعب النادي", `الأساسي: ${st.find((x) => x.id === main)?.name} — الاحتياطي: ${st.find((x) => x.id === backup)?.name ?? "—"}`, "/club/stadiums");
    await audit(u, "تحديد ملاعب النادي", "Club", clubId, { main, backup });
    return "تم حفظ الملعب الأساسي والاحتياطي — تُجدول مباريات النادي على ملعبه الأساسي";
  });
}
