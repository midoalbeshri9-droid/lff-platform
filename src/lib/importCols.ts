// أعمدة ملف استيراد اللاعبين (بالترتيب)
export const IMPORT_COLS = [
  "الاسم الرباعي *", "الاسم بالإنجليزية", "الرقم الوطني", "رقم الجواز", "تاريخ الميلاد * (YYYY-MM-DD)", "مكان الميلاد",
  "الجنسية", "أجنبي (نعم/لا)", "المركز (حارس/مدافع/وسط/مهاجم)", "الصفة (هاو/تحت العقد/محترف)", "الهاتف", "رقم القميص",
];
export const POS_MAP: Record<string, string> = { "حارس": "GOALKEEPER", "حارس مرمى": "GOALKEEPER", "مدافع": "DEFENDER", "وسط": "MIDFIELDER", "مهاجم": "FORWARD" };
export const LEVEL_MAP: Record<string, string> = { "هاو": "AMATEUR", "هاوي": "AMATEUR", "هاوٍ": "AMATEUR", "تحت العقد": "AMATEUR_CONTRACT", "محترف": "PROFESSIONAL" };
