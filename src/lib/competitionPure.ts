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

export type StandingRow = { clubId: number; name: string; group: string | null; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number; deducted: number; carried?: number; playoff?: boolean };
type MRow = { homeClubId: number; awayClubId: number; homeScore: number | null; awayScore: number | null };

/**
 * الترتيب وفق المادة (24) من لائحة تنظيم المسابقات — الاتحاد الليبي لكرة القدم:
 * ذهاب وإياب — فريقان: نتيجة مباراتيهما (فارق الأهداف ثم الأهداف خارج الملعب) ← فارق الأهداف العام ← الأهداف ← مباراة فاصلة.
 * ذهاب وإياب — أكثر من فريقين: النقاط بينهم ← فارق الأهداف بينهم ← أهدافهم ← أهدافهم خارج ملعبهم ← إعادة تطبيق ذلك على من بقي متساويًا ← فارق الأهداف العام ← الأهداف ← مباراة فاصلة.
 * مرحلة واحدة — فريقان: الفائز في مباراتهما ← فارق الأهداف العام ← الأهداف ← مباراة فاصلة.
 * مرحلة واحدة — أكثر من فريقين: النقاط بينهم ← فارق الأهداف بينهم ← أهدافهم ← إعادة التطبيق ← فارق الأهداف العام ← الأهداف ← مباراة فاصلة.
 */
export function lffRank(rows: StandingRow[], ms: MRow[], win: number, draw: number, legs: number): StandingRow[] {
  const sorted = [...rows].sort((a, b) => b.pts - a.pts);
  const out: StandingRow[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].pts === sorted[i].pts) j++;
    out.push(...resolveTie(sorted.slice(i, j), ms, win, draw, legs));
    i = j;
  }
  return out;
}

function miniStats(teams: StandingRow[], ms: MRow[], win: number, draw: number) {
  const ids = new Set(teams.map((t) => t.clubId));
  const st = new Map(teams.map((t) => [t.clubId, { pts: 0, gd: 0, gf: 0, away: 0 }]));
  for (const m of ms) {
    if (!ids.has(m.homeClubId) || !ids.has(m.awayClubId) || m.homeScore == null || m.awayScore == null) continue;
    const h = st.get(m.homeClubId)!, a = st.get(m.awayClubId)!;
    h.gf += m.homeScore; a.gf += m.awayScore; h.gd += m.homeScore - m.awayScore; a.gd += m.awayScore - m.homeScore; a.away += m.awayScore;
    if (m.homeScore > m.awayScore) h.pts += win; else if (m.homeScore < m.awayScore) a.pts += win; else { h.pts += draw; a.pts += draw; }
  }
  return st;
}

function resolveTie(teams: StandingRow[], ms: MRow[], win: number, draw: number, legs: number, sub = false): StandingRow[] {
  if (teams.length < 2) return teams;
  const st = miniStats(teams, ms, win, draw);
  const two = teams.length === 2 && !sub, double = legs >= 2; // عند إعادة التطبيق تُستخدم معايير «أكثر من فريقين»
  const key = (t: StandingRow): number[] => {
    const x = st.get(t.clubId)!;
    if (two) return double ? [x.gd, x.away] : [x.pts];
    return double ? [x.pts, x.gd, x.gf, x.away] : [x.pts, x.gd, x.gf];
  };
  const cmp = (a: number[], b: number[]) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return b[k] - a[k]; return 0; };
  const ordered = [...teams].sort((a, b) => cmp(key(a), key(b)));
  // تقسيم إلى مجموعات متساوية في المعايير
  const blocks: StandingRow[][] = [];
  for (const t of ordered) {
    const last = blocks[blocks.length - 1];
    if (last && cmp(key(last[0]), key(t)) === 0) last.push(t); else blocks.push([t]);
  }
  if (blocks.length === 1) {
    // لم تُفصل المواجهات المباشرة: فارق الأهداف العام ← الأهداف ← مباراة فاصلة
    const byAll = [...teams].sort((a, b) => b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name, "ar"));
    return byAll.map((t) => ({ ...t, playoff: byAll.some((o) => o !== t && o.gd === t.gd && o.gf === t.gf) || t.playoff }));
  }
  // إعادة تطبيق المعايير على من بقي متساويًا فقط
  return blocks.flatMap((b) => (b.length > 1 ? resolveTie(b, ms, win, draw, legs, true) : b));
}


type QIn = { clubId: number; group: string | null; pts: number; p: number; gd: number; gf: number };
/**
 * المتأهلون من مرحلة دوري/مجموعات: أول (perGroup) من كل مجموعة، ثم (best) من أفضل أصحاب المركز التالي عبر المجموعات
 * (مثل أفضل الثوالث) — يُفاضل بينهم بمعدل النقاط للمباراة (لعدالة المجموعات غير المتساوية) ثم فارق الأهداف ثم الأهداف.
 * rows مرتبة مسبقًا داخل كل مجموعة.
 */
export function pickQualifiers<T extends QIn>(rows: T[], perGroup: number, best = 0) {
  const groups = [...new Set(rows.map((r) => r.group ?? ""))];
  const q: { clubId: number; seed: number; fromGroup: string | null; pts: number }[] = [];
  const next: T[] = [];
  for (const g of groups) {
    const gr = rows.filter((r) => (r.group ?? "") === g);
    gr.slice(0, perGroup).forEach((r, i) => q.push({ clubId: r.clubId, seed: i + 1, fromGroup: g || null, pts: r.pts }));
    if (gr[perGroup]) next.push(gr[perGroup]);
  }
  if (best > 0) {
    const avg = (r: T) => (r.p ? r.pts / r.p : 0);
    const gdAvg = (r: T) => (r.p ? r.gd / r.p : 0);
    const gfAvg = (r: T) => (r.p ? r.gf / r.p : 0);
    next.sort((a, b) => avg(b) - avg(a) || gdAvg(b) - gdAvg(a) || gfAvg(b) - gfAvg(a));
    next.slice(0, best).forEach((r) => q.push({ clubId: r.clubId, seed: perGroup + 1, fromGroup: r.group || null, pts: r.pts }));
  }
  return q;
}
