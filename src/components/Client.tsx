"use client";
import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function Submit({ children, className = "btn btn-primary", confirm, name, value }: { children: ReactNode; className?: string; confirm?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) return e.preventDefault();
        // نمرّر قيمة الزر عبر حقل مخفي (أضمن من الاعتماد على الزر المُرسِل)
        const form = e.currentTarget.form;
        if (form && name) {
          let h = form.querySelector<HTMLInputElement>(`input[type=hidden][data-submitter="${name}"]`);
          if (!h) {
            h = document.createElement("input");
            h.type = "hidden";
            h.name = name;
            h.dataset.submitter = name;
            form.appendChild(h);
          }
          h.value = value ?? "";
        }
      }}
    >
      {pending ? "جارٍ التنفيذ…" : children}
    </button>
  );
}

export type NavItem = { label: string; href?: string; badge?: number; children?: (NavItem | "sep")[] };

export function NavMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [mobile, setMobile] = useState(false);
  const path = usePathname();
  const sp = useSearchParams();
  // يطابق المسار ومعاملات الرابط (مثل ?kind=new)، ويُبرز أدق رابط فقط حتى لا تُضاء عدة عناصر معًا
  const score = (h?: string) => {
    if (!h) return -1;
    const [hp, hq] = h.split("?");
    if (!(hp === "/" ? path === "/" : path === hp || path.startsWith(hp + "/"))) return -1;
    const q = new URLSearchParams(hq ?? "");
    for (const [k, v] of q) if (sp.get(k) !== v) return -1;
    return hp.length * 10 + [...q].length;
  };
  const all = items.flatMap((it) => [it.href, ...(it.children ?? []).map((c) => (c === "sep" ? undefined : c.href))]);
  const best = Math.max(-1, ...all.map(score));
  const isActive = (h?: string) => best >= 0 && score(h) === best;
  return (
    <>
      <button className="hdr-icon menu-toggle" onClick={() => setMobile(!mobile)} title="القائمة" style={{ position: "absolute", top: 18, left: 16 }}>
        ☰
      </button>
      <nav className={`lff-nav ${mobile ? "open" : ""}`}>
        <div className="lff-container">
          <ul className="menu">
            {items.map((it, i) =>
              it.children ? (
                <li key={i} className={`dd ${open === i ? "show" : ""}`}>
                  <button className={`mi ${it.children.some((c) => c !== "sep" && isActive(c.href)) ? "active" : ""}`} onClick={() => setOpen(open === i ? null : i)}>
                    {it.label} {it.badge ? <span className="pill">{it.badge}</span> : null} ▾
                  </button>
                  <div className="dd-menu">
                    {it.children.map((c, j) =>
                      c === "sep" ? (
                        <div key={j} className="dd-sep" />
                      ) : (
                        <Link key={j} href={c.href!} className={`dd-item ${isActive(c.href) ? "active" : ""}`} onClick={() => { setOpen(null); setMobile(false); }}>
                          {c.label} {c.badge ? <span className="pill">{c.badge}</span> : null}
                        </Link>
                      ),
                    )}
                  </div>
                </li>
              ) : (
                <li key={i}>
                  <Link href={it.href!} className={`mi ${isActive(it.href) ? "active" : ""}`} onClick={() => setMobile(false)}>
                    {it.label} {it.badge ? <span className="pill">{it.badge}</span> : null}
                  </Link>
                </li>
              ),
            )}
          </ul>
          {open !== null && <div className="dd-backdrop" onClick={() => setOpen(null)} />}
        </div>
      </nav>
    </>
  );
}

export function PrintButton({ label = "🖨 طباعة" }: { label?: string }) {
  return (
    <button className="btn btn-primary" onClick={() => window.print()}>
      {label}
    </button>
  );
}

export function CheckAll({ name, label = "تحديد الكل" }: { name: string; label?: string }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        onChange={(e) => document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((x) => (x.checked = e.target.checked))}
      />
      {label}
    </label>
  );
}

export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
