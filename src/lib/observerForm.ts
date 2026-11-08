// نموذج تقرير مراقب المباراة المعتمد — بنود التقييم الفني ودرجاتها العظمى والتقدير (بدون اعتماد على الخادم: يُستخدم في الواجهة والطباعة)
import type { ObserverCard, ObserverReport } from "@/db/schema";

export type EvalRole = "REFEREE" | "AR1" | "AR2" | "FOURTH";
export const EVAL_ROLES: EvalRole[] = ["REFEREE", "AR1", "AR2", "FOURTH"];
export const EVAL_TITLE: Record<EvalRole, string> = { REFEREE: "التقييم الفني للحكم", AR1: "الحكم المساعد الأول", AR2: "الحكم المساعد الثاني", FOURTH: "الحكم الرابع" };
export const CREW_LABEL: Record<EvalRole, string> = { REFEREE: "الحكم", AR1: "الحكم المساعد الأول", AR2: "الحكم المساعد الثاني", FOURTH: "الحكم الرابع" };

const AR: [string, number][] = [["الدقة في الإشارات والتمركز", 60], ["التعاون", 20], ["الصفات الشخصية والهندام", 20]];
export const CRITERIA: Record<EvalRole, [string, number][]> = {
  REFEREE: [["تطبيق قوانين اللعبة", 25], ["السيطرة على المباراة", 15], ["الصفات الشخصية", 10], ["التعامل مع اللاعبين والإداريين", 10], ["اللياقة البدنية", 15], ["التمركز", 15], ["التعاون مع الحكمين المساعدين والحكم الرابع", 10]],
  AR1: AR, AR2: AR,
  FOURTH: [["الإجراءات الإدارية قبل وأثناء وبعد المباراة", 40], ["السيطرة على المنطقة الفنية", 30], ["التعاون مع طاقم التحكيم", 15], ["الصفات الشخصية والهندام", 15]],
};
export const maxOf = (r: EvalRole) => CRITERIA[r].reduce((a, [, m]) => a + m, 0);

/** مجموع الدرجات والنسبة والتقدير — null إن لم يُقيَّم أي بند */
export function evalTotal(r: EvalRole, scores: string[] | undefined) {
  const v = (scores ?? []).map((x) => (x === "" || x == null ? NaN : Number(x)));
  if (!v.some((x) => Number.isFinite(x))) return null;
  const total = v.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const pct = Math.round((total / maxOf(r)) * 1000) / 10;
  return { total, pct, grade: gradeOf(pct) };
}
export function gradeOf(pct: number) {
  if (pct >= 90) return "ممتاز";
  if (pct >= 80) return "جيد جدًا";
  if (pct >= 70) return "جيد";
  if (pct >= 60) return "مقبول";
  return "ضعيف";
}

export const emptyReport = (): ObserverReport => ({
  ht: ["", ""], ft: ["", ""], et: ["", ""], pens: ["", ""], cautions: [], sendoffs: [], scorers: [],
  evals: {}, adminNotes: "", generalNotes: "",
});

const t = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : "");
const pair = (v: unknown): [string, string] => (Array.isArray(v) ? [t(v[0], 3).replace(/\D/g, ""), t(v[1], 3).replace(/\D/g, "")] : ["", ""]);
const idOr = (v: unknown, ok: (n: number) => boolean) => { const n = Number(v); return Number.isInteger(n) && ok(n) ? n : null; };

/** تنظيف بيانات النموذج القادمة من المتصفح (لا يُوثق بما يرسله) */
export function cleanReport(raw: unknown, clubs: number[]): ObserverReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const card = (x: Record<string, unknown>): ObserverCard => ({
    playerId: idOr(x.playerId, (n) => n > 0), name: t(x.name, 120), cardNo: t(x.cardNo, 30), clubId: idOr(x.clubId, (n) => clubs.includes(n)),
    category: t(x.category, 40), reason: t(x.reason, 120), minute: t(x.minute, 6),
  });
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object").map((x) => card(x as Record<string, unknown>)).filter((x) => x.name).slice(0, max);
  const evals: ObserverReport["evals"] = {};
  const re = (r.evals && typeof r.evals === "object" ? r.evals : {}) as Record<string, { s?: unknown[]; n?: unknown[] }>;
  for (const role of EVAL_ROLES) {
    const e = re[role];
    if (!e) continue;
    evals[role] = {
      s: CRITERIA[role].map((_, i) => { const v = t(e.s?.[i], 6); if (v === "") return ""; const n = Number(v); return Number.isFinite(n) ? String(n) : ""; }),
      n: CRITERIA[role].map((_, i) => t(e.n?.[i], 500)),
    };
  }
  return {
    ht: pair(r.ht), ft: pair(r.ft), et: pair(r.et), pens: pair(r.pens),
    cautions: list(r.cautions, 30), sendoffs: list(r.sendoffs, 15),
    scorers: (Array.isArray(r.scorers) ? r.scorers : []).map((x: Record<string, unknown>) => ({ clubId: idOr(x?.clubId, (n) => clubs.includes(n)) ?? 0, shirt: t(x?.shirt, 4), goals: t(x?.goals, 3), notes: t(x?.notes, 200) }))
      .filter((x) => x.clubId && (x.shirt || x.goals || x.notes)).slice(0, 30),
    evals, adminNotes: t(r.adminNotes, 5000), generalNotes: t(r.generalNotes, 10000),
  };
}

/** التحقق قبل الإرسال النهائي: النتيجة النهائية، ودرجات بنود كل فرد من الطاقم المعيّن ضمن حدودها */
export function validateReport(d: ObserverReport, crewRoles: EvalRole[]): string | null {
  if (d.ft[0] === "" || d.ft[1] === "") return "أدخل النتيجة النهائية";
  for (const c of [...d.cautions, ...d.sendoffs]) if (!c.clubId) return `حدّد فريق اللاعب (${c.name})`;
  for (const role of crewRoles) {
    const e = d.evals[role];
    for (const [i, [label, max]] of CRITERIA[role].entries()) {
      const v = e?.s[i];
      if (v === undefined || v === "") return `أكمل درجات ${CREW_LABEL[role]}: «${label}»`;
      if (Number(v) < 0 || Number(v) > max) return `${CREW_LABEL[role]} — «${label}»: الدرجة من 0 إلى ${max}`;
    }
  }
  return draftError(d);
}

/** حتى المسودة: لا درجة خارج حدود بندها */
export function draftError(d: ObserverReport): string | null {
  for (const role of EVAL_ROLES) {
    const s = d.evals[role]?.s ?? [];
    for (const [i, v] of s.entries()) if (v !== "" && (Number(v) < 0 || Number(v) > CRITERIA[role][i][1])) return `${CREW_LABEL[role]} — «${CRITERIA[role][i][0]}»: الدرجة من 0 إلى ${CRITERIA[role][i][1]}`;
  }
  return null;
}
