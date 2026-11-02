import { Field, Options } from "@/components/ui";
import { Submit } from "@/components/Client";
import { COMMITTEE } from "@/lib/labels";
import { today } from "@/lib/util";
import { saveCorrespondence } from "../actions";
import type { correspondence } from "@/db/schema";

type C = typeof correspondence.$inferSelect;
export function CorrForm({ c, clubs, direction, replyTo }: { c?: C; clubs: { id: number; name: string }[]; direction?: "IN" | "OUT"; replyTo?: C }) {
  const dir = c?.direction ?? direction ?? "OUT";
  return (
    <form action={saveCorrespondence} className="form f3 mt">
      {c && <input type="hidden" name="id" value={c.id} />}
      {replyTo && <input type="hidden" name="replyToId" value={replyTo.id} />}
      {!c && <Field label="النوع"><select name="direction" defaultValue={dir}><option value="OUT">صادر</option><option value="IN">وارد</option></select></Field>}
      <Field label="التاريخ"><input type="date" name="date" defaultValue={c?.date ?? today()} /></Field>
      <Field label="رقم الجهة الأخرى" hint="رقم الإشاري في كتاب الجهة"><input type="text" name="refNumber" defaultValue={c?.refNumber ?? ""} /></Field>
      <Field label="الموضوع *" full><input type="text" name="subject" required defaultValue={c?.subject ?? (replyTo ? `رد: ${replyTo.subject}` : "")} /></Field>
      <Field label="من / إلى *"><input type="text" name="party" required defaultValue={c?.party ?? replyTo?.party ?? ""} placeholder="مثال: نادي الأهلي طرابلس" /></Field>
      <Field label="اللجنة المختصة"><select name="committee" defaultValue={c?.committee ?? replyTo?.committee ?? ""}><option value="">—</option><Options map={COMMITTEE} /></select></Field>
      <Field label="النادي المرتبط"><select name="clubId" defaultValue={c?.clubId ?? replyTo?.clubId ?? ""}><option value="">—</option>{clubs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="رقم اللاعب (اختياري)"><input type="number" name="playerId" defaultValue={c?.playerId ?? replyTo?.playerId ?? ""} /></Field>
      <Field label="رقم المباراة (اختياري)"><input type="number" name="matchId" defaultValue={c?.matchId ?? replyTo?.matchId ?? ""} /></Field>
      <Field label="مطلوب الرد قبل"><input type="date" name="dueDate" defaultValue={c?.dueDate ?? ""} /></Field>
      <Field label="الملخص" full><textarea name="summary" defaultValue={c?.summary ?? ""} /></Field>
      <Field label={c?.fileKey ? "استبدال الملف" : "صورة الكتاب (PDF/صورة)"}><input type="file" name="file" accept="application/pdf,image/*" /></Field>
      <label className="check"><input type="checkbox" name="visibleToClub" value="1" defaultChecked={c?.visibleToClub ?? false} /> إتاحتها للنادي في بوابته</label>
      <div className="full"><Submit>{c ? "حفظ" : "تسجيل وإعطاء رقم"}</Submit></div>
    </form>
  );
}
