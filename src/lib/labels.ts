// التسميات العربية لكل القيم الثابتة
export const ROLE_LABEL: Record<string, string> = {
  SEC_STAFF: "موظف الأمانة العامة",
  ADMIN: "مدير المنظومة",
  PRESIDENT: "رئيس الاتحاد",
  SECRETARY_GENERAL: "الأمين العام",
  REG_HEAD: "رئيس لجنة القيد",
  REG_STAFF: "موظف لجنة القيد",
  COMP_HEAD: "رئيس لجنة المسابقات",
  COMP_STAFF: "موظف لجنة المسابقات",
  REF_HEAD: "رئيس لجنة الحكام",
  REF_STAFF: "موظف لجنة الحكام",
  CLUB_MANAGER: "مدير حساب النادي",
  CLUB_EMPLOYEE: "موظف النادي",
  CLUB_VIEWER: "اطلاع (نادٍ)",
  REFEREE: "حكم",
  OBSERVER: "مراقب مباراة",
  FIN_HEAD: "رئيس اللجنة المالية",
  FIN_STAFF: "موظف اللجنة المالية",
};

export const REG_TYPE: Record<string, string> = {
  NEW: "قيد جديد",
  RENEWAL: "تجديد قيد",
  TRANSFER: "انتقال نهائي",
  LOAN: "إعارة",
  LOAN_RETURN: "عودة من إعارة",
};

export const REG_STATUS: Record<string, [string, string]> = {
  DRAFT: ["مسودة", "b-gray"],
  SUBMITTED: ["قيد المراجعة", "b-blue"],
  NEEDS_CORRECTION: ["مطلوب استكمال", "b-amber"],
  APPROVED: ["معتمد", "b-green"],
  REJECTED: ["مرفوض", "b-red"],
  CANCELLED: ["ملغى", "b-gray"],
  TRANSFERRED: ["منتقل", "b-purple"],
  EXPIRED: ["منتهٍ", "b-gray"],
};

export const DOC_STATUS: Record<string, [string, string]> = {
  PENDING: ["بانتظار المراجعة", "b-amber"],
  APPROVED: ["مقبول", "b-green"],
  REJECTED: ["مرفوض", "b-red"],
};

export const ORIGIN: Record<string, [string, string]> = {
  NOT_REQUIRED: ["غير مطلوب", "b-gray"],
  PENDING: ["بانتظار رد النادي السابق", "b-amber"],
  AGREED: ["وافق النادي السابق", "b-green"],
  OBJECTED: ["اعترض النادي السابق", "b-red"],
};

export const PLAYER_STATUS: Record<string, [string, string]> = {
  ACTIVE: ["نشط", "b-green"],
  RETIRED: ["معتزل", "b-gray"],
  BLOCKED: ["موقوف إداريًا", "b-red"],
};

export const PRO_LEVEL: Record<string, string> = {
  AMATEUR: "هاوٍ",
  AMATEUR_CONTRACT: "هاوٍ تحت العقد",
  PROFESSIONAL: "محترف",
};

export const POSITION: Record<string, string> = {
  UNKNOWN: "غير محدد",
  GOALKEEPER: "حارس مرمى",
  DEFENDER: "مدافع",
  MIDFIELDER: "وسط",
  FORWARD: "مهاجم",
};

export const GENDER: Record<string, string> = { MALE: "ذكر", FEMALE: "أنثى" };

export const COMP_TYPE: Record<string, string> = { LEAGUE: "دوري", GROUPS: "مجموعات", CUP: "كأس (خروج المغلوب)", GROUPS_KNOCKOUT: "مجموعات ثم خروج المغلوب" };
export const TIEBREAK: Record<string, string> = { LFF: "لائحة الاتحاد الليبي (م24): المواجهات المباشرة ثم الأهداف خارج الملعب", GD: "فارق الأهداف ثم الأهداف ثم المواجهات المباشرة", H2H: "المواجهات المباشرة ثم فارق الأهداف" };
export const COMP_STATUS: Record<string, [string, string]> = {
  DRAFT: ["قيد الإعداد", "b-gray"],
  ACTIVE: ["جارية", "b-green"],
  FINISHED: ["منتهية", "b-indigo"],
};
export const MATCH_STATUS: Record<string, [string, string]> = {
  SCHEDULED: ["مجدولة", "b-blue"],
  PLAYED: ["لُعبت", "b-green"],
  POSTPONED: ["مؤجلة", "b-amber"],
  CANCELLED: ["ملغاة", "b-gray"],
  FORFEIT: ["فوز اعتباري", "b-purple"],
};
export const REPORT_STATUS: Record<string, [string, string]> = {
  NONE: ["لم يُرسل", "b-gray"],
  SUBMITTED: ["أرسله الحكم", "b-blue"],
  RETURNED: ["مُعاد للحكم", "b-amber"],
  APPROVED: ["معتمد", "b-green"],
};
export const EVENT_TYPE: Record<string, string> = {
  GOAL: "⚽ هدف",
  PENALTY_GOAL: "⚽ هدف (جزاء)",
  OWN_GOAL: "⚽ هدف عكسي",
  YELLOW: "🟨 إنذار",
  SECOND_YELLOW: "🟨🟥 إنذار ثانٍ",
  RED: "🟥 طرد مباشر",
  SUB_IN: "⬆ دخول",
  SUB_OUT: "⬇ خروج",
  INCIDENT: "⚠ حادثة",
};

export const OFFICIAL_TYPE: Record<string, string> = {
  REFEREE: "حكم ساحة",
  ASSISTANT: "حكم مساعد",
  VAR: "حكم فيديو",
  REF_OBSERVER: "مراقب مباراة",
  COMMISSIONER: "مراقب مباراة",
};
/** الأنواع المعروضة عند الإضافة (المراقب نوع واحد) */
export const OFFICIAL_TYPE_INPUT: Record<string, string> = { REFEREE: "حكم ساحة", ASSISTANT: "حكم مساعد", VAR: "حكم فيديو", COMMISSIONER: "مراقب مباراة" };
export const OFFICIAL_GRADE: Record<string, string> = {
  INTERNATIONAL: "دولي",
  FIRST: "درجة أولى",
  SECOND: "درجة ثانية",
  THIRD: "درجة ثالثة",
  TRAINEE: "متدرب",
};
export const FITNESS: Record<string, [string, string]> = {
  NOT_TESTED: ["لم يُختبر", "b-gray"],
  PASSED: ["لائق", "b-green"],
  FAILED: ["غير لائق", "b-red"],
};
export const OFFICIAL_STATUS: Record<string, [string, string]> = {
  ACTIVE: ["نشط", "b-green"],
  SUSPENDED: ["موقوف", "b-red"],
  INJURED: ["مصاب", "b-amber"],
  RETIRED: ["معتزل", "b-gray"],
};
export const ASSIGN_ROLE: Record<string, string> = {
  REFEREE: "حكم الساحة",
  AR1: "المساعد الأول",
  AR2: "المساعد الثاني",
  FOURTH: "الحكم الرابع",
  VAR: "حكم الفيديو",
  REF_OBSERVER: "مراقب المباراة",
  COMMISSIONER: "مراقب المباراة",
};
/** أدوار التعيين المعروضة (المراقب دور واحد) */
export const ASSIGN_ROLE_INPUT: Record<string, string> = { REFEREE: "حكم الساحة", AR1: "المساعد الأول", AR2: "المساعد الثاني", FOURTH: "الحكم الرابع", VAR: "حكم الفيديو", COMMISSIONER: "مراقب المباراة" };
export const ASSIGN_STATUS: Record<string, [string, string]> = {
  DRAFT: ["مسودة", "b-gray"],
  APPROVED: ["معتمد", "b-green"],
  DECLINED: ["اعتذر", "b-red"],
};
// أي نوع من الطاقم يصلح لأي دور
export const ROLE_FITS: Record<string, string[]> = {
  REFEREE: ["REFEREE"],
  AR1: ["ASSISTANT", "REFEREE"],
  AR2: ["ASSISTANT", "REFEREE"],
  FOURTH: ["REFEREE", "ASSISTANT"],
  VAR: ["VAR", "REFEREE"],
  REF_OBSERVER: ["REF_OBSERVER", "COMMISSIONER"],
  COMMISSIONER: ["COMMISSIONER", "REF_OBSERVER"],
};

export const SANCTION_TYPE: Record<string, string> = {
  WARNING: "إنذار / لفت نظر",
  FINE: "غرامة مالية",
  MATCH_BAN: "إيقاف بعدد مباريات",
  TIME_BAN: "إيقاف لمدة",
  STADIUM_BAN: "حرمان من دخول الملعب",
  POINTS_DEDUCTION: "خصم نقاط",
  CLOSED_DOORS: "اللعب دون جمهور",
  VENUE_CHANGE: "نقل المباراة لملعب آخر",
  FORFEIT: "خسارة اعتبارية (0-3)",
  REGISTRATION_BAN: "منع التسجيل والانتقالات",
};
/** أي العقوبات تصلح لأي هدف */
export const SANCTION_FOR: Record<string, string[]> = {
  PLAYER: ["WARNING", "FINE", "MATCH_BAN", "TIME_BAN", "STADIUM_BAN"],
  STAFF: ["WARNING", "FINE", "MATCH_BAN", "TIME_BAN", "STADIUM_BAN"],
  CLUB: ["WARNING", "FINE", "POINTS_DEDUCTION", "CLOSED_DOORS", "VENUE_CHANGE", "FORFEIT", "REGISTRATION_BAN"],
};
export const SANCTION_TARGET: Record<string, string> = { PLAYER: "لاعب", STAFF: "إداري / جهاز فني", CLUB: "نادٍ" };
export const SANCTION_STATUS: Record<string, [string, string]> = {
  ACTIVE: ["سارية", "b-red"],
  APPEALED: ["مطعون فيها", "b-amber"],
  REVOKED: ["ملغاة", "b-gray"],
  COMPLETED: ["منفّذة", "b-green"],
};
export const APPEAL_STATUS: Record<string, [string, string]> = {
  PENDING: ["قيد النظر", "b-amber"],
  ACCEPTED: ["مقبول — أُلغيت العقوبة", "b-green"],
  REJECTED: ["مرفوض", "b-red"],
  REDUCED: ["مقبول جزئيًا — عُدّلت العقوبة", "b-blue"],
};
export const STAFF_ROLE: Record<string, string> = {
  COACH: "مدرب", ASSISTANT_COACH: "مدرب مساعد", GK_COACH: "مدرب حراس", FITNESS_COACH: "مدرب لياقة",
  TEAM_MANAGER: "مدير الفريق", DOCTOR: "طبيب", PHYSIO: "أخصائي علاج طبيعي", ADMIN: "إداري", OTHER: "أخرى",
};
export const CHARGE_CATEGORY: Record<string, string> = {
  FINE: "غرامة", REG_FEE: "رسوم قيد", CARD_FEE: "رسوم بطاقة", ENTRY_FEE: "رسوم اشتراك مسابقة", STAFF_FEE: "رسوم قيد إداري",
  REFEREE_FEE: "مستحقات تحكيم", OTHER: "أخرى",
};
export const CHARGE_STATUS: Record<string, [string, string]> = {
  OPEN: ["غير مدفوع", "b-red"], PARTIAL: ["مدفوع جزئيًا", "b-amber"], PAID: ["مدفوع", "b-green"], WAIVED: ["معفى", "b-blue"], CANCELLED: ["ملغى", "b-gray"],
};
export const PAY_METHOD: Record<string, string> = { CASH: "نقدًا", CHEQUE: "صك", TRANSFER: "تحويل مصرفي" };
export const FEE_CODES: Record<string, string> = {
  REG_NEW: "قيد جديد", REG_RENEWAL: "تجديد قيد", REG_TRANSFER: "انتقال نهائي", REG_LOAN: "إعارة", REG_LOAN_RETURN: "عودة من إعارة",
  CARD_REPLACEMENT: "بطاقة بديلة", STAFF_REG: "قيد إداري / جهاز فني",
};

export const COMMITTEE: Record<string, string> = { BOARD: "مجلس الإدارة", SEC: "الأمانة العامة", REG: "لجنة القيد وأوضاع اللاعبين", COMP: "لجنة المسابقات", REF: "لجنة الحكام", FIN: "اللجنة المالية", DISC: "لجنة الانضباط", APPEAL: "لجنة الاستئناف", MED: "اللجنة الطبية", OTHER: "أخرى" };
/** اللجنة التي ينتمي إليها دور المستخدم (لمتابعة القرارات المكلفة بها) */
export const ROLE_COMMITTEE: Record<string, string> = { REG_HEAD: "REG", REG_STAFF: "REG", COMP_HEAD: "COMP", COMP_STAFF: "COMP", REF_HEAD: "REF", REF_STAFF: "REF", FIN_HEAD: "FIN", FIN_STAFF: "FIN", SECRETARY_GENERAL: "SEC", SEC_STAFF: "SEC", PRESIDENT: "BOARD" };
export const DECISION_STATUS: Record<string, [string, string]> = { PENDING: ["بانتظار التنفيذ", "b-amber"], IN_PROGRESS: ["قيد التنفيذ", "b-blue"], DONE: ["نُفّذ", "b-green"], CANCELLED: ["ملغى", "b-gray"] };
export const CORR_STATUS: Record<string, [string, string]> = { OPEN: ["مفتوحة", "b-amber"], REPLIED: ["تم الرد", "b-blue"], CLOSED: ["مغلقة", "b-green"] };
export const STADIUM_STATUS: Record<string, [string, string]> = { APPROVED: ["معتمد", "b-green"], CONDITIONAL: ["معتمد بشروط", "b-amber"], SUSPENDED: ["موقوف", "b-red"], CLOSED: ["مغلق", "b-gray"] };
export const INSPECTION_RESULT: Record<string, string> = { PASS: "صالح", CONDITIONAL: "صالح بشروط", FAIL: "غير صالح" };

/** مراقب المباراة تعيّنه لجنة المسابقات، وبقية الطاقم لجنة الحكام */
export const OBSERVER_ROLES = ["COMMISSIONER", "REF_OBSERVER"];
export const ARCHIVE_CATEGORY: Record<string, string> = {
  DECISIONS: "قرارات", CORRESPONDENCE: "مراسلات", MINUTES: "محاضر", REGULATIONS: "لوائح وتعاميم", CONTRACTS: "عقود واتفاقيات",
  MATCH_REPORTS: "تقارير المباريات", PLAYERS: "ملفات اللاعبين", CLUBS: "ملفات الأندية", REFEREES: "ملفات الحكام",
  FINANCE: "مالية", LEGAL: "قانونية وقضايا", MEDIA: "إعلام وصور", HR: "شؤون إدارية وموظفون", OTHER: "أخرى",
};
export const CONFIDENTIALITY: Record<string, [string, string]> = { GENERAL: ["عامة للجان", "b-gray"], COMMITTEE: ["خاصة باللجنة", "b-amber"], SECRET: ["سرية", "b-red"] };
