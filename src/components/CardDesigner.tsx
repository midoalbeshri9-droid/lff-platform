"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CardElement } from "@/db/schema";
import { CARD_FIELDS, SAMPLE } from "@/lib/cardFields";
import { CardFace } from "./CardFace";
import { saveCardTemplate, uploadCardImage } from "@/app/(main)/registration/actions";

type T = { id?: number; name: string; widthMm: number; heightMm: number; front: CardElement[]; back: CardElement[] | null; frontBg: string | null; backBg: string | null; isDefault: boolean };
const PX_PER_MM = 96 / 25.4;
const uid = () => Math.random().toString(36).slice(2, 9);

export function CardDesigner({ initial }: { initial: T }) {
  const [t, setT] = useState<T>(initial);
  const [side, setSide] = useState<"front" | "back">("front");
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const scale = 2.6;
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; o: CardElement } | null>(null);

  const els = (side === "front" ? t.front : t.back) ?? [];
  const setEls = (fn: (e: CardElement[]) => CardElement[]) =>
    setT((p) => (side === "front" ? { ...p, front: fn(p.front) } : { ...p, back: fn(p.back ?? []) }));
  const cur = els.find((e) => e.id === sel) ?? null;
  const upd = (patch: Partial<CardElement>) => setEls((a) => a.map((e) => (e.id === sel ? { ...e, ...patch } : e)));

  function add(kind: CardElement["kind"], field?: string) {
    const base: CardElement = { id: uid(), kind, x: 4, y: 4, w: 30, h: 5, fontSize: 8, align: "right", color: "#111111" };
    if (kind === "photo") Object.assign(base, { w: 20, h: 25 });
    if (kind === "logo") Object.assign(base, { w: 12, h: 14 });
    if (kind === "qr") Object.assign(base, { w: 14, h: 14 });
    if (kind === "rect") Object.assign(base, { w: t.widthMm, h: 8, x: 0, y: 0, bg: "#4C7A30" });
    if (kind === "text") Object.assign(base, { text: "نص ثابت" });
    if (kind === "field") Object.assign(base, { field: field ?? "fullName", w: 40 });
    setEls((a) => [...a, base]);
    setSel(base.id);
  }

  function onDown(ev: React.PointerEvent, id: string, mode: "move" | "resize") {
    ev.preventDefault();
    setSel(id);
    const o = els.find((e) => e.id === id)!;
    drag.current = { id, mode, sx: ev.clientX, sy: ev.clientY, o: { ...o } };
  }
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.sx) / (PX_PER_MM * scale), dy = (ev.clientY - d.sy) / (PX_PER_MM * scale);
      const snap = (v: number) => Math.round(v * 2) / 2;
      setEls((a) => a.map((e) => e.id !== d.id ? e : d.mode === "move"
        ? { ...e, x: snap(d.o.x + dx), y: snap(d.o.y + dy) }
        : { ...e, w: Math.max(2, snap(d.o.w + dx)), h: Math.max(2, snap(d.o.h + dy)) }));
    };
    const up = () => (drag.current = null);
    const key = (ev: KeyboardEvent) => {
      if (!sel || (ev.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      const st = ev.shiftKey ? 2 : 0.5;
      const m: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
      if (m[ev.key]) { ev.preventDefault(); setEls((a) => a.map((e) => (e.id === sel ? { ...e, x: e.x + m[ev.key][0], y: e.y + m[ev.key][1] } : e))); }
      if (ev.key === "Delete") { setEls((a) => a.filter((e) => e.id !== sel)); setSel(null); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key); };
  });

  async function upload(file: File, target: "bg" | "image") {
    const f = new FormData();
    f.set("file", file);
    const r = await uploadCardImage(f);
    if ("error" in r && r.error) return setMsg(r.error);
    if (!("key" in r)) return;
    if (target === "bg") setT((p) => (side === "front" ? { ...p, frontBg: r.key! } : { ...p, backBg: r.key! }));
    else { const id = uid(); setEls((a) => [...a, { id, kind: "image", imageKey: r.key!, x: 5, y: 5, w: 15, h: 15 }]); setSel(id); }
  }

  function save() {
    start(async () => {
      const r = await saveCardTemplate(t);
      if ("error" in r && r.error) return setMsg(r.error);
      setMsg("✓ تم حفظ القالب");
      if (!t.id && "id" in r && r.id) router.replace(`/registration/cards/templates/${r.id}`);
    });
  }

  const bg = side === "front" ? t.frontBg : t.backBg;
  return (
    <div className="designer">
      <div>
        <div className="card">
          <div className="row" style={{ marginBottom: ".6rem" }}>
            <div className="tabs" style={{ margin: 0, border: 0 }}>
              <button className={`tab ${side === "front" ? "active" : ""}`} onClick={() => { setSide("front"); setSel(null); }}>الوجه الأمامي</button>
              <button className={`tab ${side === "back" ? "active" : ""}`} onClick={() => { setSide("back"); setSel(null); if (!t.back) setT((p) => ({ ...p, back: [] })); }}>الوجه الخلفي</button>
            </div>
            <span className="spacer" />
            <span className="muted" style={{ fontSize: ".8rem" }}>{t.widthMm} × {t.heightMm} ملم — اسحب العناصر، والأسهم للتحريك الدقيق، Delete للحذف</span>
          </div>
          <div className="canvas-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
            <CardFace els={els} w={t.widthMm} h={t.heightMm} bg={bg ? `/api/files/${bg}` : null} data={SAMPLE} scale={scale} selected={sel} onDown={onDown} />
          </div>
          <div className="btn-row mt">
            <select onChange={(e) => { if (e.target.value) add("field", e.target.value); e.target.value = ""; }} defaultValue="" style={{ width: "auto" }}>
              <option value="">+ حقل بيانات…</option>
              {CARD_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <button className="btn btn-light btn-sm" onClick={() => add("photo")}>+ صورة اللاعب</button>
            <button className="btn btn-light btn-sm" onClick={() => add("qr")}>+ رمز QR</button>
            <button className="btn btn-light btn-sm" onClick={() => add("logo")}>+ شعار الاتحاد</button>
            <button className="btn btn-light btn-sm" onClick={() => add("text")}>+ نص ثابت</button>
            <button className="btn btn-light btn-sm" onClick={() => add("rect")}>+ شريط ملوّن</button>
            <label className="btn btn-light btn-sm">+ صورة/شعار<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "image")} /></label>
            <label className="btn btn-gold btn-sm">🖼 خلفية الوجه<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "bg")} /></label>
            {bg && <button className="btn btn-ghost btn-sm" onClick={() => setT((p) => (side === "front" ? { ...p, frontBg: null } : { ...p, backBg: null }))}>إزالة الخلفية</button>}
          </div>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: ".6rem" }}>الخلفية المقترحة: صورة 1012×638 بكسل (300dpi لمقاس CR80). البيانات الظاهرة هنا عيّنة للمعاينة.</p>
        </div>
      </div>

      <div className="card props">
        <div className="field"><label>اسم القالب</label><input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></div>
        <div className="row2">
          <div className="field"><label>العرض (ملم)</label><input type="number" step="0.1" value={t.widthMm} onChange={(e) => setT({ ...t, widthMm: +e.target.value })} /></div>
          <div className="field"><label>الارتفاع (ملم)</label><input type="number" step="0.1" value={t.heightMm} onChange={(e) => setT({ ...t, heightMm: +e.target.value })} /></div>
        </div>
        <label className="check" style={{ margin: ".4rem 0" }}><input type="checkbox" checked={t.isDefault} onChange={(e) => setT({ ...t, isDefault: e.target.checked })} /> القالب الافتراضي للطباعة</label>
        <hr />
        {!cur ? <p className="muted">اختر عنصرًا لتعديل خصائصه.</p> : (
          <div className="stack">
            <strong>{cur.kind === "field" ? CARD_FIELDS.find((f) => f.key === cur.field)?.label : { photo: "صورة اللاعب", qr: "رمز QR", logo: "الشعار", text: "نص ثابت", rect: "شريط", image: "صورة" }[cur.kind]}</strong>
            {cur.kind === "field" && (
              <div className="field"><label>الحقل</label><select value={cur.field} onChange={(e) => upd({ field: e.target.value })}>{CARD_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
            )}
            {(cur.kind === "text" || cur.kind === "field") && (
              <div className="field"><label>{cur.kind === "text" ? "النص" : "بادئة (مثل: الاسم:)"}</label><input type="text" value={cur.text ?? ""} onChange={(e) => upd({ text: e.target.value })} /></div>
            )}
            <div className="row2">
              <div className="field"><label>X</label><input type="number" step="0.5" value={cur.x} onChange={(e) => upd({ x: +e.target.value })} /></div>
              <div className="field"><label>Y</label><input type="number" step="0.5" value={cur.y} onChange={(e) => upd({ y: +e.target.value })} /></div>
              <div className="field"><label>العرض</label><input type="number" step="0.5" value={cur.w} onChange={(e) => upd({ w: +e.target.value })} /></div>
              <div className="field"><label>الارتفاع</label><input type="number" step="0.5" value={cur.h} onChange={(e) => upd({ h: +e.target.value })} /></div>
            </div>
            {(cur.kind === "text" || cur.kind === "field") && (<>
              <div className="row2">
                <div className="field"><label>حجم الخط (pt)</label><input type="number" step="0.5" value={cur.fontSize ?? 8} onChange={(e) => upd({ fontSize: +e.target.value })} /></div>
                <div className="field"><label>اللون</label><input type="color" value={cur.color ?? "#111111"} onChange={(e) => upd({ color: e.target.value })} /></div>
              </div>
              <div className="row2">
                <div className="field"><label>المحاذاة</label><select value={cur.align ?? "right"} onChange={(e) => upd({ align: e.target.value as "right" })}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></div>
                <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={!!cur.bold} onChange={(e) => upd({ bold: e.target.checked })} /> عريض</label>
              </div>
            </>)}
            <div className="row2">
              <div className="field"><label>لون الخلفية</label><input type="color" value={cur.bg ?? "#ffffff"} onChange={(e) => upd({ bg: e.target.value })} /></div>
              <div className="field"><label>تدوير الزوايا</label><input type="number" step="0.5" value={cur.radius ?? 0} onChange={(e) => upd({ radius: +e.target.value })} /></div>
            </div>
            {cur.bg && <button className="btn btn-ghost btn-sm" onClick={() => upd({ bg: undefined })}>بلا خلفية</button>}
            <div className="btn-row">
              <button className="btn btn-light btn-sm" onClick={() => { const c = { ...cur, id: uid(), x: cur.x + 2, y: cur.y + 2 }; setEls((a) => [...a, c]); setSel(c.id); }}>تكرار</button>
              <button className="btn btn-light btn-sm" onClick={() => setEls((a) => [...a.filter((e) => e.id !== cur.id), cur])}>للأمام</button>
              <button className="btn btn-light btn-sm" onClick={() => setEls((a) => [cur, ...a.filter((e) => e.id !== cur.id)])}>للخلف</button>
              <button className="btn btn-danger btn-sm" onClick={() => { setEls((a) => a.filter((e) => e.id !== cur.id)); setSel(null); }}>حذف</button>
            </div>
          </div>
        )}
        <hr />
        {msg && <div className={`alert ${msg.startsWith("✓") ? "ok" : "err"}`}>{msg}</div>}
        <button className="btn btn-primary w100" onClick={save} disabled={pending}>{pending ? "جارٍ الحفظ…" : "💾 حفظ القالب"}</button>
      </div>
    </div>
  );
}
