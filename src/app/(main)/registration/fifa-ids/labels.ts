const RESULT: Record<string, string> = {
  NEW: "يُضاف رقم FIFA ID", SAME: "مطابق مسبقًا", CONFLICT: "له رقم مختلف", TAKEN: "الرقم مستخدم لشخص آخر",
  NOT_FOUND: "لم يُعثر عليه", AMBIGUOUS: "أكثر من تطابق", NO_ID: "لا يوجد رقم FIFA ID في السطر", SET: "أُضيف", OVERWRITTEN: "استُبدل",
};
export const resultLabel = (k: string) => RESULT[k] ?? k;
