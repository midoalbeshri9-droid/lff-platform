import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { documentTypes, staff, staffDocuments, players } from "@/db/schema";
import { staffGroup, LICENSED_ROLES } from "./labels";
import { today } from "./util";

type S = typeof staff.$inferSelect;

/** المستندات الإلزامية حسب الدور والمستوى (كما في FIFA Connect) */
export async function staffRequiredDocs(s: Pick<S, "role" | "level" | "nationality">) {
  const g = staffGroup(s.role);
  const all = await db.select().from(documentTypes).where(and(eq(documentTypes.isActive, true), eq(documentTypes.scope, "STAFF"))).orderBy(documentTypes.sortOrder);
  return all.filter((d) => {
    if (!d.requiredFor.includes(g)) return false;
    if (d.onlyProfessional && s.level !== "PROFESSIONAL") return false;
    if (d.onlyForeign && (s.nationality ?? "ليبي").includes("ليب")) return false;
    return true;
  });
}

export async function staffDocTypes() {
  return db.select().from(documentTypes).where(and(eq(documentTypes.isActive, true), eq(documentTypes.scope, "STAFF"))).orderBy(documentTypes.sortOrder);
}

export async function staffMissing(s: S) {
  const m: string[] = [];
  if (!s.photoKey) m.push("الصورة الشخصية");
  if (!s.nationalId) m.push("الرقم الوطني / رقم الجواز");
  if (!s.dateOfBirth) m.push("تاريخ الميلاد");
  if (LICENSED_ROLES.includes(s.role)) {
    if (!s.level) m.push("مستوى المدرب (هاوٍ/محترف)");
    if (!s.licenseLevel) m.push("الرخصة التدريبية");
    if (!s.licenseUntil) m.push("تاريخ صلاحية الرخصة");
  }
  const req = await staffRequiredDocs(s);
  const docs = await db.select().from(staffDocuments).where(eq(staffDocuments.staffId, s.id));
  for (const t of req) if (!docs.some((d) => d.documentTypeId === t.id && d.status !== "REJECTED")) m.push(t.name);
  return m;
}

/** تنبيهات للمراجع */
export function staffWarnings(s: S) {
  const w: string[] = [];
  if (s.licenseUntil && s.licenseUntil < today()) w.push(`الرخصة التدريبية منتهية منذ ${s.licenseUntil}`);
  if (s.role === "COACH" && s.licenseLevel && !["CAF Pro", "CAF A"].includes(s.licenseLevel)) w.push(`المدرب الأول برخصة ${s.licenseLevel} — أقل من CAF A`);
  if (LICENSED_ROLES.includes(s.role) && !s.licenseLevel) w.push("لا توجد رخصة تدريبية");
  return w;
}

/** بيانات شخص مسجّل مسبقًا بنفس الرقم الوطني (مدرب/إداري سابق أو لاعب) — «Add Role» بدل تكرار الشخص */
export async function personByNationalId(nid: string, exceptId?: number) {
  const [st] = await db.select().from(staff).where(and(eq(staff.nationalId, nid), exceptId ? ne(staff.id, exceptId) : undefined)).orderBy(desc(staff.id)).limit(1);
  if (st) return { fullName: st.fullName, nationality: st.nationality, dateOfBirth: st.dateOfBirth, phone: st.phone, photoKey: st.photoKey, email: st.email, address: st.address,
    licenseNo: st.licenseNo, licenseLevel: st.licenseLevel, licenseFrom: st.licenseFrom, licenseUntil: st.licenseUntil, source: "staff" as const };
  const [p] = await db.select().from(players).where(eq(players.nationalId, nid)).limit(1);
  if (p) return { fullName: p.fullName, nationality: p.nationality, dateOfBirth: p.dateOfBirth, phone: p.phone, photoKey: p.photoKey, email: null, address: p.address,
    licenseNo: null, licenseLevel: null, licenseFrom: null, licenseUntil: null, source: "player" as const };
  return null;
}
