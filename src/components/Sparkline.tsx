/** منحنى تقييمات الحكم عبر الموسم (SVG بسيط، من 0 إلى 10) */
export function TrendChart({ points }: { points: { label: string; v: number }[] }) {
  if (points.length < 1) return null;
  const W = 560, H = 150, P = 26;
  const x = (i: number) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const lo = Math.max(0, Math.floor(Math.min(...points.map((p) => p.v)) - 1)), hi = 10;
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const avg = points.reduce((a, p) => a + p.v, 0) / points.length;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", direction: "ltr" }} role="img" aria-label="منحنى التقييمات">
      {[lo, (lo + hi) / 2, hi].map((g) => <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#e5e2d9" /><text x={4} y={y(g) + 4} fontSize="10" fill="#888">{g}</text></g>)}
      <line x1={P} x2={W - P} y1={y(avg)} y2={y(avg)} stroke="#C9A23F" strokeDasharray="5 4" />
      <text x={W - P} y={y(avg) - 4} fontSize="10" fill="#9a7b25" textAnchor="end">المتوسط {avg.toFixed(2)}</text>
      <path d={d} fill="none" stroke="#4C7A30" strokeWidth="2.5" />
      {points.map((p, i) => <g key={i}><circle cx={x(i)} cy={y(p.v)} r="4" fill="#4C7A30"><title>{`${p.label}: ${p.v}`}</title></circle><text x={x(i)} y={y(p.v) - 8} fontSize="10" textAnchor="middle" fill="#333">{p.v}</text></g>)}
    </svg>
  );
}
