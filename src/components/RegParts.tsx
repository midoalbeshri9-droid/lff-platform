import type { RegFull } from "@/lib/regview";
import { REG_STATUS, REG_TYPE, DOC_STATUS, ORIGIN, PRO_LEVEL, POSITION, PLAYER_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime, ageOn, today } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { Badge } from "./ui";

export function RegSummary({ x }: { x: RegFull }) {
  const { r, p } = x;
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-start", gap: "1.2rem" }}>
        {p.photoKey ? <a href={fileUrl(p.photoKey)!} target="_blank"><img className="photo-lg" src={fileUrl(p.photoKey)!} alt="" /></a> : <div className="photo-lg ph" style={{ width: 130, height: 160 }}>👤</div>}
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ marginBottom: ".3rem" }}>{p.fullName}</h2>
          {p.fullNameEn && <div className="muted kbd">{p.fullNameEn}</div>}
          <div className="tag-list" style={{ margin: ".5rem 0" }}>
            <Badge v={REG_STATUS[r.status]} />
            <span className="b b-indigo">{REG_TYPE[r.type]}</span>
            {r.originResponse !== "NOT_REQUIRED" && <Badge v={ORIGIN[r.originResponse]} />}
            {p.isForeign && <span className="b b-purple">أجنبي</span>}
            {p.status !== "ACTIVE" && <Badge v={PLAYER_STATUS[p.status]} />}
            {x.susp.length > 0 && <span className="b b-red">موقوف حاليًا</span>}
          </div>
          <dl className="dl">
            <dt>رقم القيد</dt><dd className="kbd">{r.number ?? "— (يُمنح عند الاعتماد)"}</dd>
            <dt>النادي</dt><dd>{x.club.name}{x.fromClub && <span className="muted"> — قادم من: {x.fromClub}</span>}</dd>
            <dt>الموسم / الفئة</dt><dd>{x.season.name} — {x.cat ?? "—"}</dd>
            <dt>الرقم الوطني</dt><dd className="kbd">{p.nationalId ?? "—"}{p.passportNo && <> / جواز: {p.passportNo}</>}</dd>
            <dt>الميلاد</dt><dd>{fmtDate(p.dateOfBirth)} ({ageOn(p.dateOfBirth, today())} سنة){p.placeOfBirth && ` — ${p.placeOfBirth}`}</dd>
            <dt>الجنسية</dt><dd>{p.nationality}</dd>
            <dt>الصفة / المركز</dt><dd>{PRO_LEVEL[p.professionalLevel]} — {POSITION[p.position]}{r.shirtNumber && ` — قميص ${r.shirtNumber}`}</dd>
            {(r.contractStart || r.contractEnd) && (<><dt>العقد</dt><dd>{fmtDate(r.contractStart)} ← {fmtDate(r.contractEnd)}</dd></>)}
            {r.loanEndDate && (<><dt>نهاية الإعارة</dt><dd>{fmtDate(r.loanEndDate)}</dd></>)}
            {p.phone && (<><dt>الهاتف</dt><dd className="kbd">{p.phone}</dd></>)}
          </dl>
        </div>
      </div>
      {r.possibleDuplicates && <div className="alert warn mt">⚠ لاعبون مشابهون (نفس الاسم وتاريخ الميلاد): {r.possibleDuplicates}</div>}
      {r.decisionReason && ["REJECTED", "NEEDS_CORRECTION"].includes(r.status) && <div className="alert err mt"><strong>ملاحظة لجنة القيد:</strong> {r.decisionReason}</div>}
      {r.originReason && <div className="alert info mt"><strong>رد النادي السابق:</strong> {r.originReason}</div>}
      {x.susp.map((s) => <div key={s.id} className="alert err mt">⛔ {s.kind === "ADMIN" ? `إيقاف إداري${s.endDate ? " حتى " + fmtDate(s.endDate) : ""}` : `إيقاف ${(s.matchesTotal ?? 0) - s.matchesServed} مباراة`}: {s.reason}</div>)}
    </div>
  );
}

export function DocStatusBadge({ s }: { s: string }) {
  return <Badge v={DOC_STATUS[s]} />;
}

export function Timeline({ x }: { x: RegFull }) {
  return (
    <div className="card">
      <h3>سجل الطلب</h3>
      <ul className="timeline">
        {x.events.map((e) => (
          <li key={e.id}>
            <div className="when">{fmtDateTime(e.at)} — {e.userName}</div>
            <div className="what">{e.action}</div>
            {e.note && <div className="note">{e.note}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function docMissing(x: RegFull) {
  return x.required.filter((t) => !x.docs.some((d) => d.d.documentTypeId === t.id && d.d.status !== "REJECTED"));
}
