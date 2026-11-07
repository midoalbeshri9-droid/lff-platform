"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toJpeg } from "@/lib/xlsxClient";
import { uploadReportFile } from "@/app/(main)/portal/actions";

const LIMIT = 4.2 * 1048576;
/** إرفاق التقرير الورقي (صور أو PDF) — كل ملف في طلب مستقل */
export function ReportFileUploader({ matchId, kind }: { matchId: number; kind: "REFEREE" | "COMMISSIONER" }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msgs, setMsgs] = useState<string[]>([]);
  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []); if (!files.length) return;
    const out: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`جارٍ رفع ${i + 1} / ${files.length} ...`);
      let f = files[i];
      if (f.type.startsWith("image/") && f.size > 1.5 * 1048576) {
        const b = await toJpeg(f, 2200, 0.85).catch(() => null);
        if (b) f = new File([b], f.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
      }
      if (f.size > LIMIT) { out.push(`${f.name}: أكبر من 4 م.ب — اضغطه أو قسّمه`); continue; }
      const fd = new FormData(); fd.set("matchId", String(matchId)); fd.set("kind", kind); fd.set("file", f);
      const r = await uploadReportFile(fd).catch(() => ({ ok: false, msg: "انقطع الاتصال" }));
      out.push(`${f.name}: ${r.msg}`);
    }
    setMsgs(out); setBusy(""); router.refresh();
  }
  return (
    <div className="field">
      <label>إرفاق التقرير الورقي (صور أو PDF — يمكن اختيار عدة ملفات)</label>
      <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => onFiles(e.target.files)} disabled={!!busy} />
      {busy && <small>{busy}</small>}
      {msgs.map((m) => <small key={m} className="muted" style={{ display: "block" }}>{m}</small>)}
    </div>
  );
}
