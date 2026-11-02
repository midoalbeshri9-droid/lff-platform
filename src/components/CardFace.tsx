import type { CardElement } from "@/db/schema";

/** رسم وجه بطاقة بالملّيمتر — يُستخدم في المصمم والطباعة والمعاينة */
export function CardFace({
  els, w, h, bg, data, photo, qr, scale = 1, className = "", selected, onDown,
}: {
  els: CardElement[]; w: number; h: number; bg?: string | null; data: Record<string, string>; photo?: string | null; qr?: string | null;
  scale?: number; className?: string; selected?: string | null;
  onDown?: (e: React.PointerEvent, id: string, mode: "move" | "resize") => void;
}) {
  const mm = (v: number) => `${v * scale}mm`;
  return (
    <div className={`canvas ${className}`} style={{ width: mm(w), height: mm(h), backgroundImage: bg ? `url(${bg})` : undefined, backgroundSize: "100% 100%" }}>
      {els.map((e) => {
        const style: React.CSSProperties = {
          left: mm(e.x), top: mm(e.y), width: mm(e.w), height: mm(e.h),
          fontSize: `${(e.fontSize ?? 8) * scale}pt`, fontWeight: e.bold ? 700 : 400, color: e.color ?? "#111",
          // العنصر باتجاه RTL: بداية المحور يمين
          justifyContent: e.align === "left" ? "flex-end" : e.align === "center" ? "center" : "flex-start",
          textAlign: e.align ?? "right", direction: "rtl", background: e.bg ?? undefined, borderRadius: e.radius ? mm(e.radius) : undefined,
          fontFamily: "Cairo, Tahoma, Arial, sans-serif",
        };
        let inner: React.ReactNode = null;
        if (e.kind === "photo") inner = photo ? <img src={photo} alt="" /> : <span style={{ margin: "auto", fontSize: `${14 * scale}pt`, color: "#aaa" }}>👤</span>;
        else if (e.kind === "logo") inner = <img src="/img/logo-256.png" alt="" style={{ objectFit: "contain" }} />;
        else if (e.kind === "image") inner = e.imageKey ? <img src={`/api/files/${e.imageKey}`} alt="" style={{ objectFit: "contain" }} /> : null;
        else if (e.kind === "qr") inner = qr ? <img src={qr} alt="" style={{ objectFit: "contain" }} /> : <span style={{ margin: "auto", fontSize: `${7 * scale}pt`, color: "#555", border: "1px dashed #999", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>QR</span>;
        else if (e.kind === "rect") inner = null;
        else if (e.kind === "text") inner = <span>{e.text}</span>;
        else inner = <span style={{ whiteSpace: "nowrap" }}>{e.text ? `${e.text} ` : ""}<bdi>{data[e.field ?? ""] ?? ""}</bdi></span>;
        return (
          <div key={e.id} className={`el ${["logo", "image", "qr"].includes(e.kind) ? "contain" : ""} ${selected === e.id ? "sel" : ""}`} style={style}
            onPointerDown={onDown ? (ev) => onDown(ev, e.id, "move") : undefined}>
            {inner}
            {onDown && selected === e.id && <span className="rs" onPointerDown={(ev) => { ev.stopPropagation(); onDown(ev, e.id, "resize"); }} />}
          </div>
        );
      })}
    </div>
  );
}
