import type { Role } from "@/db/schema";

// كل الصلاحيات في المنظومة، مجمّعة حسب الجهة — يعدّلها مدير النظام من مصفوفة الصلاحيات
export const PERMISSION_GROUPS: { group: string; items: [string, string][] }[] = [
  {
    group: "لجنة القيد وأوضاع اللاعبين",
    items: [
      ["reg.view", "عرض اللاعبين وطلبات القيد لكل الأندية"],
      ["reg.review", "مراجعة الطلبات والمستندات (قبول / رفض / إعادة)"],
      ["reg.edit", "تعديل بيانات لاعب بعد اعتماده"],
      ["reg.windows", "إدارة المواسم وفترات القيد والفئات والمستندات"],
      ["reg.suspend", "الإيقاف الإداري للاعبين ورفعه"],
      ["reg.lists", "استخراج قوائم الفرق وتصديرها"],
      ["reg.contracts", "الاطلاع على القيم المالية للعقود"],
      ["reg.staff", "اعتماد الإداريين والجهاز الفني"],
      ["cards.print", "طباعة بطاقات اللاعبين"],
      ["cards.design", "تصميم قوالب البطاقات"],
    ],
  },
  {
    group: "لجنة المسابقات",
    items: [
      ["comp.view", "عرض المسابقات والمباريات"],
      ["comp.manage", "إدارة المسابقات والفرق والجدولة"],
      ["comp.lineups", "إدخال قوائم المباريات لأي نادٍ"],
      ["comp.reports", "اعتماد تقارير المباريات والنتائج"],
      ["comp.reports.view", "الاطلاع على تقارير الحكام ومراقبي المباريات (سرية للجنة المسابقات)"],
      ["comp.suspend", "إيقاف لاعبين بعدد مباريات ورفعه"],
      ["comp.sanctions", "إصدار قرارات العقوبات والبت في الطعون"],
      ["comp.articles", "إدارة لائحة العقوبات"],
      ["comp.requests", "البت في طلبات تأجيل المباريات"],
      ["comp.stadiums", "إدارة سجل الملاعب والمعاينات"],
      ["comp.observers", "تعيين مراقبي المباريات"],
    ],
  },
  {
    group: "لجنة الحكام",
    items: [
      ["ref.view", "عرض الحكام وتعيينات التحكيم"],
      ["ref.manage", "إدارة سجل الحكام والاختبارات"],
      ["ref.assign", "تعيين طواقم التحكيم (مسودة)"],
      ["ref.approve", "اعتماد تعيينات الحكام"],
      ["ref.evals", "الاطلاع على تقييمات الحكام"],
    ],
  },
  {
    group: "اللجنة المالية",
    items: [
      ["fin.view", "الاطلاع على الحسابات والتقارير المالية"],
      ["fin.manage", "تسجيل الدفعات والمستحقات وإصدار الإيصالات"],
      ["fin.approve", "الإعفاء من المستحقات وإلغاء الإيصالات"],
      ["fin.settings", "جدول الرسوم ومستحقات الحكام وإعدادات المالية"],
    ],
  },
  {
    group: "الأمانة العامة",
    items: [
      ["sec.view", "الاطلاع على الصادر والوارد والمحاضر والقرارات"],
      ["sec.manage", "تسجيل المراسلات والمحاضر والقرارات"],
      ["kpi.view", "لوحة المؤشرات والمقارنة بين المواسم"],
    ],
  },
  {
    group: "الأرشيف الإلكتروني",
    items: [
      ["archive.view", "البحث في الأرشيف والاطلاع على الوثائق العامة"],
      ["archive.manage", "إضافة الوثائق وتعديلها وحذفها"],
      ["archive.secret", "الاطلاع على الوثائق السرية وكل وثائق اللجان"],
    ],
  },
  {
    group: "إدارة الدرجة",
    items: [
      ["div.clubs", "إضافة أندية الدرجة وتعديلها وتعطيلها"],
      ["div.users", "إنشاء حسابات الدرجة (الأندية، الحكام، موظفي الدرجة) ومنح صلاحياتهم وسجل عمليات الدرجة"],
    ],
  },
  {
    group: "الإدارة",
    items: [
      ["admin.users", "إدارة المستخدمين والحسابات"],
      ["admin.permissions", "تعديل مصفوفة الصلاحيات"],
      ["admin.clubs", "إدارة الأندية"],
      ["admin.audit", "سجل العمليات"],
      ["admin.outbox", "صندوق الرسائل الصادرة (روابط التفعيل)"],
      ["admin.settings", "الإعدادات العامة"],
      ["reports.view", "التقارير والإحصائيات"],
    ],
  },
  {
    group: "بوابة الأندية",
    items: [
      ["club.view", "عرض لاعبي النادي وطلباته"],
      ["club.edit", "إضافة لاعبين ورفع المستندات"],
      ["club.submit", "إرسال الطلبات إلى لجنة القيد"],
      ["club.lineups", "إرسال قوائم المباريات"],
      ["club.origin", "الرد على طلبات انتقال لاعبي النادي"],
      ["club.finance", "الاطلاع على الحساب المالي للنادي"],
      ["club.appeals", "تقديم الطعون وطلبات التأجيل"],
    ],
  },
  {
    group: "بوابة الحكام ومراقبي المباريات",
    items: [
      ["portal.referee", "إدخال تقرير المباراة (حكم الساحة)"],
      ["portal.observer", "إدخال تقرير مراقب المباراة وتقييم الحكام"],
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i[0]));

const fed = (p: string) => !p.startsWith("club.") && !p.startsWith("portal.");
/** الصلاحيات التي يملكها المدير دائمًا */
export const ADMIN_LOCKED = ["admin.users", "admin.permissions"];
const VIEW = ["reg.view", "comp.view", "ref.view", "ref.evals", "reports.view", "admin.audit", "fin.view"];

export const DEFAULT_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ALL_PERMISSIONS.filter(fed),
  PRESIDENT: [...VIEW, "sec.view", "kpi.view", "archive.view", "archive.secret"],
  SECRETARY_GENERAL: [...VIEW, "sec.view", "sec.manage", "kpi.view", "archive.view", "archive.manage", "archive.secret"],
  SEC_STAFF: ["sec.view", "sec.manage", "archive.view", "archive.manage"],
  REG_HEAD: ["reg.view", "reg.review", "reg.edit", "reg.windows", "reg.suspend", "reg.lists", "reg.contracts", "reg.staff", "cards.print", "cards.design", "comp.view", "reports.view", "sec.view", "archive.view", "archive.manage"],
  REG_STAFF: ["reg.view", "reg.review", "reg.lists", "reg.contracts", "reg.staff", "cards.print", "archive.view"],
  COMP_HEAD: ["comp.view", "comp.reports.view", "comp.manage", "comp.lineups", "comp.reports", "comp.suspend", "comp.sanctions", "comp.articles", "comp.requests", "comp.stadiums", "comp.observers", "reg.view", "ref.view", "reports.view", "sec.view", "archive.view", "archive.manage"],
  COMP_STAFF: ["comp.view", "comp.reports.view", "comp.manage", "comp.lineups", "comp.requests", "comp.stadiums", "comp.observers", "reg.view", "ref.view", "archive.view"],
  REF_HEAD: ["ref.view", "ref.manage", "ref.assign", "ref.approve", "ref.evals", "comp.view", "reports.view", "sec.view", "archive.view", "archive.manage"],
  REF_STAFF: ["ref.view", "ref.manage", "ref.assign", "comp.view", "archive.view"],
  CLUB_MANAGER: ["club.view", "club.edit", "club.submit", "club.lineups", "club.origin", "club.finance", "club.appeals"],
  CLUB_EMPLOYEE: ["club.view", "club.edit", "club.lineups"],
  CLUB_VIEWER: ["club.view"],
  REFEREE: ["portal.referee"],
  OBSERVER: ["portal.observer"],
  FIN_HEAD: ["fin.view", "fin.manage", "fin.approve", "fin.settings", "reports.view", "sec.view", "archive.view", "archive.manage"],
  FIN_STAFF: ["fin.view", "fin.manage", "archive.view"],
  // مدير الدرجة: يدير كل ما يخص درجته فقط (القيد والمسابقات والحكام)
  DIV_MANAGER: ["div.clubs", "div.users", "comp.stadiums", "reg.windows", "reg.view", "reg.review", "reg.edit", "reg.suspend", "reg.lists", "reg.staff", "cards.print", "comp.view", "comp.reports.view", "comp.manage", "comp.lineups", "comp.reports", "comp.suspend", "comp.sanctions", "comp.requests", "comp.observers", "ref.view", "ref.manage", "ref.assign", "ref.approve", "ref.evals"],
  DIV_STAFF: ["reg.view", "reg.review", "reg.lists", "reg.staff", "cards.print", "comp.view", "comp.lineups", "comp.requests", "ref.view", "ref.assign"],
};

/**
 * الصلاحيات التي يمكن أن تُمنح لمستخدم محصور في درجة.
 * أي صلاحية خارجها (المالية، الأمانة، الأرشيف، الإدارة، الإعدادات العامة، اللوائح...) تُسحب منه تلقائيًا مهما كانت مصفوفة دوره.
 */
export const SCOPEABLE = new Set([
  "reg.view", "reg.review", "reg.edit", "reg.suspend", "reg.lists", "reg.contracts", "reg.staff", "cards.print",
  "comp.view", "comp.reports.view", "comp.manage", "comp.lineups", "comp.reports", "comp.suspend", "comp.sanctions", "comp.requests", "comp.observers",
  "ref.view", "ref.manage", "ref.assign", "ref.approve", "ref.evals",
  "div.clubs", "div.users", "comp.stadiums", "reg.windows",
]);
export const DIVISION_ROLES: Role[] = ["DIV_MANAGER", "DIV_STAFF"];

export const CLUB_ROLES: Role[] = ["CLUB_MANAGER", "CLUB_EMPLOYEE", "CLUB_VIEWER"];
export const OFFICIAL_ROLES: Role[] = ["REFEREE", "OBSERVER"];
export const isClubRole = (r: Role) => CLUB_ROLES.includes(r);
export const isOfficialRole = (r: Role) => OFFICIAL_ROLES.includes(r);
