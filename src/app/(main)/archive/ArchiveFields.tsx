import { Field, Options } from "@/components/ui";
import { ARCHIVE_CATEGORY, COMMITTEE, CONFIDENTIALITY } from "@/lib/labels";
import type { archiveDocs } from "@/db/schema";

type D = typeof archiveDocs.$inferSelect;
type L = { id: number; name: string }[];

export function ArchiveFields({ d, clubs, comps, seasons, canSecret }: { d?: D; clubs: L; comps: L; seasons: L; canSecret: boolean }) {
  return (
    <>
      <Field label="التصنيف"><select name="category" defaultValue={d?.category ?? "OTHER"}><Options map={ARCHIVE_CATEGORY} /></select></Field>
      <Field label="اللجنة / الجهة"><select name="committee" defaultValue={d?.committee ?? ""}><option value="">—</option><Options map={COMMITTEE} /></select></Field>
      <Field label="درجة السرية"><select name="confidentiality" defaultValue={d?.confidentiality ?? "GENERAL"}>
        {Object.entries(CONFIDENTIALITY).filter(([k]) => canSecret || k !== "SECRET").map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
      </select></Field>
      <Field label="تاريخ الوثيقة"><input type="date" name="docDate" defaultValue={d?.docDate ?? ""} /></Field>
      <Field label="رقم الوثيقة الأصلي"><input type="text" name="refNumber" defaultValue={d?.refNumber ?? ""} /></Field>
      <Field label="الموسم"><select name="seasonId" defaultValue={d?.seasonId ?? ""}><option value="">—</option>{seasons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="النادي"><select name="clubId" defaultValue={d?.clubId ?? ""}><option value="">—</option>{clubs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="المسابقة"><select name="competitionId" defaultValue={d?.competitionId ?? ""}><option value="">—</option>{comps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="رقم اللاعب" hint="من ملف اللاعب"><input type="number" name="playerId" defaultValue={d?.playerId ?? ""} /></Field>
      <Field label="رقم المباراة"><input type="number" name="matchId" defaultValue={d?.matchId ?? ""} /></Field>
      <Field label="رقم الحكم / المراقب"><input type="number" name="officialId" defaultValue={d?.officialId ?? ""} /></Field>
      <Field label="مكان النسخة الورقية" hint="الخزانة / الرف / الملف"><input type="text" name="physicalLocation" defaultValue={d?.physicalLocation ?? ""} /></Field>
      <Field label="يُحتفظ بها حتى"><input type="date" name="retentionUntil" defaultValue={d?.retentionUntil ?? ""} /></Field>
      <Field label="كلمات مفتاحية" hint="مفصولة بفواصل"><input type="text" name="tags" defaultValue={d?.tags ?? ""} /></Field>
      <Field label="الوصف" full><textarea name="description" defaultValue={d?.description ?? ""} /></Field>
    </>
  );
}
