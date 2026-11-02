/** جدولة دوري ذهاب وإياب بطريقة الدوران (Round-robin) */
export function roundRobin(teamIds: number[], legs: number) {
  const t = [...teamIds];
  if (t.length % 2) t.push(0); // 0 = راحة
  const n = t.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i], b = t[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop()!);
  }
  const out: { round: number; home: number; away: number }[] = [];
  for (let leg = 0; leg < legs; leg++)
    rounds.forEach((pairs, i) =>
      pairs.forEach(([h, a]) => out.push({ round: leg * rounds.length + i + 1, home: leg % 2 ? a : h, away: leg % 2 ? h : a })),
    );
  return out;
}


export const GROUP_LETTERS = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي", "ك", "ل"];

/** اسم دور خروج المغلوب حسب عدد الفرق فيه */
export function koRoundName(teams: number, round: number) {
  if (teams === 2) return "النهائي";
  if (teams === 4) return "نصف النهائي";
  if (teams === 8) return "ربع النهائي";
  if (teams === 16) return "دور الـ16";
  if (teams === 32) return "دور الـ32";
  return `الدور ${round}`;
}

/**
 * أزواج الدور الأول في خروج المغلوب.
 * فرق متأهلة من مجموعات: أول كل مجموعة يلاقي ثاني المجموعة المجاورة (أ1×ب2، ب1×أ2، ج1×د2 ...).
 * بدون تصنيف: قرعة عشوائية.
 */
export function koPairs(teams: { clubId: number; seed: number | null; fromGroup: string | null }[], random: () => number = Math.random): [number, number][] {
  const seeded = teams.length > 0 && teams.every((t) => t.seed != null && t.fromGroup);
  if (!seeded) {
    const ids = teams.map((t) => t.clubId).sort(() => random() - 0.5);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < ids.length; i += 2) out.push([ids[i], ids[i + 1]]);
    return out;
  }
  const groups = [...new Set(teams.map((t) => t.fromGroup!))].sort((a, b) => GROUP_LETTERS.indexOf(a) - GROUP_LETTERS.indexOf(b) || a.localeCompare(b, "ar"));
  const at = (g: string, s: number) => teams.find((t) => t.fromGroup === g && t.seed === s)?.clubId;
  const maxSeed = Math.max(...teams.map((t) => t.seed!));
  const used = new Set<number>();
  const out: [number, number][] = [];
  // أعلى تصنيف يلاقي أدنى تصنيف من المجموعة المجاورة
  for (let s = 1; s <= Math.ceil(maxSeed / 2); s++) {
    const opp = maxSeed + 1 - s;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const pg = groups.length > 1 ? groups[i % 2 === 0 ? i + 1 : i - 1] ?? groups[0] : g;
      const a = at(g, s), b = at(pg, opp);
      if (a && b && a !== b && !used.has(a) && !used.has(b)) { out.push([a, b]); used.add(a); used.add(b); }
    }
  }
  // ما تبقى (أعداد غير متناظرة) يُقرع عشوائيًا
  const rest = teams.map((t) => t.clubId).filter((id) => !used.has(id)).sort(() => random() - 0.5);
  for (let i = 0; i + 1 < rest.length; i += 2) out.push([rest[i], rest[i + 1]]);
  return out;
}

type Leg = { homeClubId: number; awayClubId: number; homeScore: number | null; awayScore: number | null; homePens: number | null; awayPens: number | null; leg: number | null; status: string };

/** الفائز في مواجهة خروج المغلوب (مجموع المباراتين ثم ركلات الترجيح في آخر مباراة). null = لم تُحسم */
export function tieWinner(legs: Leg[]): number | null {
  if (!legs.length) return null;
  const sorted = [...legs].sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
  if (sorted.some((m) => !["PLAYED", "FORFEIT"].includes(m.status) || m.homeScore == null || m.awayScore == null)) return null;
  const A = sorted[0].homeClubId, B = sorted[0].awayClubId;
  let ga = 0, gb = 0;
  for (const m of sorted) {
    if (m.homeClubId === A) { ga += m.homeScore!; gb += m.awayScore!; } else { ga += m.awayScore!; gb += m.homeScore!; }
  }
  if (ga !== gb) return ga > gb ? A : B;
  const last = sorted[sorted.length - 1];
  if (last.homePens == null || last.awayPens == null || last.homePens === last.awayPens) return null;
  return last.homePens > last.awayPens ? last.homeClubId : last.awayClubId;
}

/** مجموع نتيجة المواجهة من منظور الفريق الأول */
export function tieAggregate(legs: Leg[]) {
  const sorted = [...legs].sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
  const A = sorted[0]?.homeClubId;
  let ga = 0, gb = 0;
  for (const m of sorted) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.homeClubId === A) { ga += m.homeScore; gb += m.awayScore; } else { ga += m.awayScore; gb += m.homeScore; }
  }
  return { a: A, ga, gb };
}
