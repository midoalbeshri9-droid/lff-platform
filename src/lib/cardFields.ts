// الحقول المتاحة في تصميم البطاقة (تُستخدم في المصمم والطباعة)
export const CARD_FIELDS: { key: string; label: string; sample: string }[] = [
  { key: "fullName", label: "اسم اللاعب", sample: "محمد علي أحمد الورفلي" },
  { key: "fullNameEn", label: "الاسم بالإنجليزية", sample: "MOHAMED ALI ELWARFALLI" },
  { key: "club", label: "النادي", sample: "نادي الأهلي طرابلس" },
  { key: "clubEn", label: "النادي بالإنجليزية", sample: "Al Ahli Tripoli" },
  { key: "number", label: "رقم القيد", sample: "2026-00123" },
  { key: "season", label: "الموسم", sample: "2026-2027" },
  { key: "category", label: "الفئة العمرية", sample: "الفريق الأول" },
  { key: "dob", label: "تاريخ الميلاد", sample: "14/03/2001" },
  { key: "birthYear", label: "سنة الميلاد", sample: "2001" },
  { key: "nationalId", label: "الرقم الوطني", sample: "119920123456" },
  { key: "nationality", label: "الجنسية", sample: "ليبي" },
  { key: "position", label: "المركز", sample: "وسط" },
  { key: "shirt", label: "رقم القميص", sample: "10" },
  { key: "level", label: "الصفة", sample: "محترف" },
  { key: "regType", label: "نوع القيد", sample: "قيد جديد" },
  { key: "approvedAt", label: "تاريخ الاعتماد", sample: "01/09/2026" },
  { key: "validUntil", label: "صالحة حتى (نهاية الموسم)", sample: "30/06/2027" },
  { key: "fedName", label: "اسم الاتحاد", sample: "الاتحاد الليبي لكرة القدم" },
];
export const SAMPLE: Record<string, string> = Object.fromEntries(CARD_FIELDS.map((f) => [f.key, f.sample]));
