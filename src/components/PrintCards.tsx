"use client";
import { useState } from "react";
import { recordPrints } from "@/app/(main)/registration/actions";

export function PrintCardsBar({ ids, templateId, replacement, count }: { ids: number[]; templateId: number; replacement: boolean; count: number }) {
  const [done, setDone] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <div className="print-toolbar no-print" style={{ flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn btn-primary" onClick={() => window.print()}>🖨 طباعة {count} بطاقة</button>
      {replacement && <input type="text" placeholder="سبب البطاقة البديلة" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 220 }} />}
      <button className="btn btn-gold" disabled={!!done} onClick={async () => {
        const r = await recordPrints(ids, templateId, replacement, reason || null);
        setDone(`✓ سُجلت طباعة ${r.count} بطاقة`);
      }}>تأكيد نجاح الطباعة وتسجيلها</button>
      {done && <span className="ok-text">{done}</span>}
      <span className="muted" style={{ fontSize: ".82rem", width: "100%", textAlign: "center" }}>
        في نافذة الطباعة: اختر طابعة Fargo DTC1250e، الحجم CR80، الهوامش «بلا»، والمقياس 100%. فعّل «رسومات الخلفية».
      </span>
    </div>
  );
}
