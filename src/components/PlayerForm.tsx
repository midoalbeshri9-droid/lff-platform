import { Field, Options } from "./ui";
import { POSITION, PRO_LEVEL, GENDER } from "@/lib/labels";

type P = Partial<{
  fullName: string; fullNameEn: string | null; cardNo: string | null; motherName: string | null; nationalId: string | null; passportNo: string | null;
  dateOfBirth: string; placeOfBirth: string | null; gender: string; nationality: string; isForeign: boolean; position: string;
  professionalLevel: string; phone: string | null; address: string | null; city: string | null;
}>;

/** حقول بيانات اللاعب — limited: النادي يعدّل بيانات الاتصال والمركز فقط بعد أول اعتماد */
export function PlayerFields({ p = {}, limited = false, photoRequired = false, federation = false }: { p?: P; limited?: boolean; photoRequired?: boolean; federation?: boolean }) {
  const dis = limited ? { disabled: true } : {};
  return (
    <>
      <Field label="الاسم الرباعي (بالعربية) *"><input type="text" name="fullName" defaultValue={p.fullName ?? ""} required {...dis} /></Field>
      <Field label="الاسم بالإنجليزية (كما في الجواز)"><input type="text" name="fullNameEn" dir="ltr" defaultValue={p.fullNameEn ?? ""} {...dis} /></Field>
      <Field label="اسم الأم"><input type="text" name="motherName" defaultValue={p.motherName ?? ""} {...dis} /></Field>
      <Field label="الرقم الوطني" hint="12 رقمًا — إلزامي لليبيين"><input type="text" name="nationalId" dir="ltr" inputMode="numeric" maxLength={12} defaultValue={p.nationalId ?? ""} {...dis} /></Field>
      {federation && <Field label="رقم البطاقة (الاتحاد)"><input type="text" name="cardNo" dir="ltr" defaultValue={p.cardNo ?? ""} /></Field>}
      <Field label="رقم جواز السفر"><input type="text" name="passportNo" dir="ltr" defaultValue={p.passportNo ?? ""} {...dis} /></Field>
      <Field label="تاريخ الميلاد *"><input type="date" name="dateOfBirth" defaultValue={p.dateOfBirth ?? ""} required {...dis} /></Field>
      <Field label="مكان الميلاد"><input type="text" name="placeOfBirth" defaultValue={p.placeOfBirth ?? ""} {...dis} /></Field>
      <Field label="الجنس">
        <select name="gender" defaultValue={p.gender ?? "MALE"} {...dis}><Options map={GENDER} /></select>
      </Field>
      <Field label="الجنسية"><input type="text" name="nationality" defaultValue={p.nationality ?? "ليبي"} {...dis} /></Field>
      <Field label="لاعب أجنبي؟">
        <label className="check"><input type="checkbox" name="isForeign" defaultChecked={p.isForeign} {...dis} /> نعم — يُحتسب ضمن حصة الأجانب</label>
      </Field>
      <Field label="المركز"><select name="position" defaultValue={p.position ?? "UNKNOWN"}><Options map={POSITION} /></select></Field>
      <Field label="صفة اللاعب"><select name="professionalLevel" defaultValue={p.professionalLevel ?? "AMATEUR"}><Options map={PRO_LEVEL} /></select></Field>
      <Field label="الهاتف"><input type="text" name="phone" dir="ltr" defaultValue={p.phone ?? ""} /></Field>
      <Field label="المدينة"><input type="text" name="city" defaultValue={p.city ?? ""} /></Field>
      <Field label="العنوان" full><input type="text" name="address" defaultValue={p.address ?? ""} /></Field>
      <Field label={`الصورة الشخصية${photoRequired ? " *" : ""}`} hint="صورة حديثة بخلفية فاتحة — JPG أو PNG">
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required={photoRequired} />
      </Field>
    </>
  );
}
