"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { correspondence, meetings, decisions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub, notifyRoles } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { nextSerial, committeeOf } from "@/lib/secretariat";
import { COMMITTEE } from "@/lib/labels";
import { attempt, str, req, int, bool, UserError, today } from "@/lib/util";
import type { Role } from "@/db/schema";

const COMMITTEE_ROLES: Record<string, Role[]> = {
  REG: ["REG_HEAD", "REG_STAFF"], COMP: ["COMP_HEAD", "COMP_STAFF"], REF: ["REF_HEAD", "REF_STAFF"], FIN: ["FIN_HEAD", "FIN_STAFF"],
  SEC: ["SECRETARY_GENERAL", "SEC_STAFF"], BOARD: ["PRESIDENT", "SECRETARY_GENERAL"],
};
async function upload(f: FormData, folder: string) {
  const file = f.get("file") as File | null;
  return file && file.size ? saveUpload(file, folder) : null;
}

// ---------------- الصادر والوارد ----------------
export async function saveCorrespondence(f: FormData) {
  const u = await requireUser("sec.manage");
  const id = int(f, "id");
  let newId = id;
  await attempt(() => (newId ? `/secretariat/mail/${newId}` : "/secretariat/mail"), async () => {
    const up = await upload(f, "correspondence");
    const direction = str(f, "direction") === "IN" ? "IN" : "OUT";
    const data = {
      refNumber: str(f, "refNumber"), date: str(f, "date") ?? today(), subject: req(f, "subject", "الموضوع"), party: req(f, "party", direction === "IN" ? "الجهة المرسلة" : "الجهة المرسل إليها"),
      committee: str(f, "committee"), clubId: int(f, "clubId"), playerId: int(f, "playerId"), matchId: int(f, "matchId"), summary: str(f, "summary"),
      dueDate: str(f, "dueDate"), visibleToClub: bool(f, "visibleToClub"), replyToId: int(f, "replyToId"),
      ...(up ? { fileKey: up.key, fileName: up.name } : {}),
    };
    if (data.visibleToClub && !data.clubId) throw new UserError("حدد النادي لإتاحة المراسلة في بوابته");
    if (id) await db.update(correspondence).set(data).where(eq(correspondence.id, id));
    else {
      const number = await nextSerial(direction === "IN" ? "و" : "ص", Number(data.date.slice(0, 4)));
      const [row] = await db.insert(correspondence).values({ ...data, direction, number, createdBy: u.fullName }).returning();
      newId = row.id;
      if (data.replyToId) await db.update(correspondence).set({ status: "REPLIED" }).where(eq(correspondence.id, data.replyToId));
      if (data.visibleToClub && data.clubId) await notifyClub(data.clubId, `مراسلة من الاتحاد رقم ${number}`, data.subject, "/club/mail");
      if (direction === "IN" && data.committee && COMMITTEE_ROLES[data.committee]) await notifyRoles(COMMITTEE_ROLES[data.committee], `وارد جديد ${number}`, data.subject, `/secretariat/mail/${row.id}`);
      await audit(u, direction === "IN" ? "تسجيل وارد" : "تسجيل صادر", "Correspondence", row.id, number);
      return `تم التسجيل برقم ${number}`;
    }
    await audit(u, "تعديل مراسلة", "Correspondence", id, data.subject);
    return "تم الحفظ";
  });
}

export async function setCorrespondenceStatus(f: FormData) {
  const u = await requireUser("sec.manage");
  const id = int(f, "id")!;
  await attempt(`/secretariat/mail/${id}`, async () => {
    const status = str(f, "status") ?? "OPEN";
    await db.update(correspondence).set({ status }).where(eq(correspondence.id, id));
    await audit(u, "تغيير حالة مراسلة", "Correspondence", id, status);
    return "تم التحديث";
  });
}

// ---------------- المحاضر ----------------
export async function saveMeeting(f: FormData) {
  const u = await requireUser("sec.manage");
  const id = int(f, "id");
  let newId = id;
  await attempt(() => (newId ? `/secretariat/meetings/${newId}` : "/secretariat/meetings"), async () => {
    const up = await upload(f, "meetings");
    const body = str(f, "body") ?? "BOARD";
    const data = {
      body, date: str(f, "date") ?? today(), location: str(f, "location"), attendees: str(f, "attendees"), agenda: str(f, "agenda"), minutes: str(f, "minutes"),
      ...(up ? { fileKey: up.key } : {}),
    };
    if (id) {
      await db.update(meetings).set(data).where(eq(meetings.id, id));
      await audit(u, "تعديل محضر", "Meeting", id);
      return "تم حفظ المحضر";
    }
    const SHORT: Record<string, string> = { BOARD: "مج", SEC: "أع", REG: "قي", COMP: "مس", REF: "حك", FIN: "مل", DISC: "ان", APPEAL: "اس", MED: "طب", OTHER: "أخ" };
    const number = await nextSerial(`م.${SHORT[body] ?? "أخ"}`, Number(data.date.slice(0, 4)));
    const [row] = await db.insert(meetings).values({ ...data, number, createdBy: u.fullName }).returning();
    newId = row.id;
    await audit(u, "إنشاء محضر", "Meeting", row.id, number);
    return `تم إنشاء المحضر ${number} — أضف قراراته`;
  });
}

export async function approveMeeting(f: FormData) {
  const u = await requireUser("sec.manage");
  const id = int(f, "id")!;
  await attempt(`/secretariat/meetings/${id}`, async () => {
    await db.update(meetings).set({ status: "APPROVED" }).where(eq(meetings.id, id));
    await audit(u, "اعتماد محضر", "Meeting", id);
    return "اعتُمد المحضر";
  });
}

// ---------------- القرارات ----------------
export async function saveDecision(f: FormData) {
  const u = await requireUser("sec.manage");
  const meetingId = int(f, "meetingId");
  const back = meetingId ? `/secretariat/meetings/${meetingId}` : "/secretariat/decisions";
  await attempt(back, async () => {
    const up = await upload(f, "decisions");
    const data = {
      meetingId, body: str(f, "body") ?? "BOARD", date: str(f, "date") ?? today(), title: req(f, "title", "عنوان القرار"), text: str(f, "text"),
      assignee: str(f, "assignee"), dueDate: str(f, "dueDate"), clubId: int(f, "clubId"), ...(up ? { fileKey: up.key } : {}),
    };
    const number = await nextSerial("ق", Number(data.date.slice(0, 4)));
    const [row] = await db.insert(decisions).values({ ...data, number, createdBy: u.fullName }).returning();
    if (data.assignee && COMMITTEE_ROLES[data.assignee]) await notifyRoles(COMMITTEE_ROLES[data.assignee], `قرار مطلوب تنفيذه ${number}`, data.title, "/secretariat/decisions?mine=1");
    if (data.clubId) await notifyClub(data.clubId, `قرار ${number}`, data.title, "/club/mail");
    await audit(u, "تسجيل قرار", "Decision", row.id, number);
    return `تم تسجيل القرار ${number}${data.assignee ? ` وإبلاغ ${COMMITTEE[data.assignee]}` : ""}`;
  });
}

/** متابعة التنفيذ: الأمانة العامة، أو اللجنة المكلفة بالقرار */
export async function followUpDecision(f: FormData) {
  const u = await requireUser();
  const id = int(f, "id")!;
  await attempt(str(f, "back") ?? "/secretariat/decisions", async () => {
    const [d] = await db.select().from(decisions).where(eq(decisions.id, id));
    if (!d) throw new UserError("القرار غير موجود");
    if (!u.can("sec.manage") && committeeOf(u.role) !== d.assignee) throw new UserError("لا تملك صلاحية متابعة هذا القرار");
    const status = str(f, "status") ?? d.status;
    if (status === "CANCELLED" && !u.can("sec.manage")) throw new UserError("الإلغاء من صلاحية الأمانة العامة");
    const note = str(f, "note");
    const followUp = note ? `${d.followUp ? d.followUp + "\n" : ""}${today()} — ${u.fullName}: ${note}` : d.followUp;
    await db.update(decisions).set({ status, followUp, updatedAt: new Date() }).where(eq(decisions.id, id));
    if (status === "DONE" && d.status !== "DONE") await notifyRoles(["SECRETARY_GENERAL", "SEC_STAFF"], `نُفّذ القرار ${d.number}`, d.title, "/secretariat/decisions");
    await audit(u, "متابعة قرار", "Decision", id, { status, note });
    return "تم تحديث المتابعة";
  });
}
