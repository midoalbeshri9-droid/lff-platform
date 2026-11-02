import { saveSquadList } from "@/app/(main)/competitions/actions";
import { Submit, CheckAll } from "./Client";

export function SquadListForm({ competitionId, clubId, max, maxForeign, rows, readOnly }: {
  competitionId: number; clubId?: number; max: number; maxForeign: number | null; readOnly?: boolean;
  rows: { id: number; name: string; num: string | null; cat: string | null; pos: string; foreign: boolean; checked: boolean }[];
}) {
  return (
    <form action={saveSquadList} className="card">
      <input type="hidden" name="competitionId" value={competitionId} />
      {clubId && <input type="hidden" name="clubId" value={clubId} />}
      <div className="alert info">المختارون حاليًا: <strong>{rows.filter((r) => r.checked).length}</strong> من {max}{maxForeign != null && <> — الأجانب في قائمة المباراة حتى {maxForeign}</>}</div>
      {!readOnly && <CheckAll name="player" />}
      <div className="table-wrap mt">
        <table className="t"><thead><tr><th></th><th>اللاعب</th><th>رقم القيد</th><th>الفئة</th><th>المركز</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><input type="checkbox" name="player" value={r.id} defaultChecked={r.checked} disabled={readOnly} /></td>
              <td><strong>{r.name}</strong>{r.foreign && <span className="b b-purple" style={{ marginInlineStart: 6 }}>أجنبي</span>}</td>
              <td className="kbd">{r.num}</td><td>{r.cat}</td><td>{r.pos}</td></tr>
          ))}</tbody></table>
      </div>
      {!readOnly && <div className="mt"><Submit>💾 حفظ قائمة الموسم</Submit></div>}
    </form>
  );
}
