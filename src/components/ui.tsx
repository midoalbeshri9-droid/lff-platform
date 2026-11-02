import Link from "next/link";
import type { ReactNode } from "react";

export function PageHead({ title, sub, crumbs, actions }: { title: string; sub?: ReactNode; crumbs?: [string, string?][]; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="titles">
        {crumbs && (
          <div className="crumbs">
            {crumbs.map(([t, h], i) => (
              <span key={i}>
                {h ? <Link href={h}>{t}</Link> : t}
                {i < crumbs.length - 1 ? " / " : ""}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Badge({ v }: { v: [string, string] | undefined | string }) {
  if (!v) return null;
  if (typeof v === "string") return <span className="b b-gray">{v}</span>;
  return <span className={`b ${v[1]}`}>{v[0]}</span>;
}

export function Flash({ sp }: { sp: { ok?: string; err?: string } }) {
  return (
    <>
      {sp.ok && <div className="alert ok">✓ {sp.ok}</div>}
      {sp.err && <div className="alert err">{sp.err}</div>}
    </>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, children, full, hint }: { label: string; children: ReactNode; full?: boolean; hint?: string }) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Kpi({ v, l, color, href }: { v: ReactNode; l: string; color?: "red" | "gold" | "ink"; href?: string }) {
  return (
    <div className={`kpi ${color ?? ""}`}>
      <div className="v">{v}</div>
      <div className="l">{l}</div>
      {href && <Link className="stretched" href={href} aria-label={l} />}
    </div>
  );
}

export function Options({ map }: { map: Record<string, string | [string, string]> }) {
  return (
    <>
      {Object.entries(map).map(([k, v]) => (
        <option key={k} value={k}>
          {Array.isArray(v) ? v[0] : v}
        </option>
      ))}
    </>
  );
}

export type SP = Promise<Record<string, string | undefined>>;
