"use client";
import { useTransition } from "react";
import { waDone, waDismissAll } from "@/app/(main)/wa/actions";

type Item = { id: number; toName: string; link: string | null; status: string; preview: string };

/** رسائل واتساب الجاهزة بعد زر تأكيد: ضغطة تفتح واتساب بالرقم والرسالة، ثم «إرسال» داخل واتساب */
export function WaOutbox({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();
  if (!items.length) return null;
  const ready = items.filter((i) => i.link);
  return (
    <div className="wa-box">
      <div className="wa-head">
        <strong>📲 إشعارات واتساب جاهزة ({ready.length})</strong>
        <span className="muted">اضغط على الاسم ليُفتح واتساب والرسالة مكتوبة، ثم اضغط «إرسال»</span>
        <a className="btn btn-sm btn-ghost" href="/wa">السجل</a>
        <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => start(() => waDismissAll())}>إخفاء الكل</button>
      </div>
      <div className="wa-list">
        {items.map((i) => i.link ? (
          <a key={i.id} className="wa-btn" href={i.link} target="_blank" rel="noopener noreferrer" title={i.preview}
            onClick={() => start(() => waDone(i.id))}>🟢 {i.toName}</a>
        ) : (
          <span key={i.id} className="wa-btn wa-none" title={i.preview}>⚠ {i.toName}: {i.status === "FAILED" ? "فشل الإرسال التلقائي" : "لا يوجد رقم هاتف مسجّل"}</span>
        ))}
      </div>
    </div>
  );
}
