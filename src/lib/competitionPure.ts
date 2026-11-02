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

