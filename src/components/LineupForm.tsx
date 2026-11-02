import type { EligibilityRow } from "@/lib/eligibility";
import { Submit } from "./Client";

type Squad = { playerId: number; isStarter: boolean; isCaptain: boolean; shirtNumber: number | null };

/** نموذج قائمة المباراة مع فحص الأهلية: غير المؤهلين معطّلون ويظهر السبب */
export function LineupForm({
  action, matchId, clubId, elig, squad, readOnly, startersCount, squadMax, maxForeign,
}: {
  action: (f: FormData) => Promise<void>; matchId: number; clubId: number; elig: EligibilityRow[]; squad: Squad[];
  readOnly?: boolean; startersCount: number; squadMax: number; maxForeign: number | null;
}) {
  const inSquad = (id: number) => squad.find((s) => s.playerId === id);
  const okN = elig.filter((e) => e.ok).length;
  return (
    <form action={action}>
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="clubId" value={clubId} />
      <div className="alert info">
        الأساسيون: <strong>{startersCount}</strong> — الحد الأقصى للقائمة: <strong>{squadMax}</strong>
        {maxForeign != null && <> — الأجانب: حتى <strong>{maxForeign}</strong></>} — المؤهلون الآن: <strong>{okN}</strong> من {elig.length}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>في القائمة</th><th>أساسي</th><th>قائد</th><th>رقم</th><th>اللاعب</th><th>رقم القيد</th><th>الفئة</th><th>الأهلية</th></tr></thead>
          <tbody>
            {elig.map((e) => {
              const s = inSquad(e.playerId);
              const dis = readOnly || !e.ok;
              return (
                <tr key={e.playerId} className={e.ok ? "elig-ok" : "elig-bad"}>
                  <td className="num"><input type="checkbox" name="player" value={e.playerId} defaultChecked={!!s && e.ok} disabled={dis} /></td>
                  <td className="num"><input type="checkbox" name="starter" value={e.playerId} defaultChecked={s?.isStarter} disabled={dis} /></td>
                  <td className="num"><input type="radio" name="captain" value={e.playerId} defaultChecked={s?.isCaptain} disabled={dis} /></td>
                  <td><input type="number" name={`num_${e.playerId}`} defaultValue={s?.shirtNumber ?? e.shirtNumber ?? ""} min={1} max={99} style={{ width: 64 }} disabled={dis} /></td>
                  <td><strong>{e.fullName}</strong>{e.isForeign && <span className="b b-purple" style={{ marginInlineStart: 6 }}>أجنبي</span>}</td>
                  <td className="kbd">{e.number}</td>
                  <td>{e.categoryName ?? "—"}</td>
                  <td>{e.ok ? <span className="ok-mark">✓ مؤهل</span> : <span className="bad-mark">✗ {e.reasons.join("، ")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && <div className="mt"><Submit>💾 حفظ القائمة</Submit></div>}
    </form>
  );
}
