import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, players, clubs, registrations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { inScopeClub, guardPage } from "@/lib/scope";
import { amountWords, missingForSubmit, monthsBetween } from "@/lib/contracts";
import { CONTRACT_STATUS } from "@/lib/labels";
import { fmtDateTime, money } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Badge, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { EContractSummary } from "@/components/EContract";
import { approveContract, returnContract, terminateContract } from "../actions";

const MONEY_KEYS = ["totalValue", "signingBonus", "monthlySalary", "housingAmount", "transportAmount"] as const;

export default async function RegContract({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("reg.contracts");
  const { id } = await params;
  const sp = await searchParams;
  const [row] = await db.select({ c: contracts, name: players.fullName, club: clubs.name, regNo: registrations.number, regStatus: registrations.status }).from(contracts)
    .innerJoin(players, eq(players.id, contracts.playerId)).innerJoin(clubs, eq(clubs.id, contracts.clubId))
    .innerJoin(registrations, eq(registrations.id, contracts.registrationId)).where(eq(contracts.id, Number(id)));
  if (!row) notFound();
  guardPage(await inScopeClub(u, row.c.clubId));
  const { c, name, club } = row;
  const words = Object.fromEntries(MONEY_KEYS.map((k) => [k, amountWords(c[k], c.currency)]));
  const miss = missingForSubmit(c);
  // تنبيهات للمراجع: هل تتسق الأرقام؟
  const warn: string[] = [];
  const months = monthsBetween(c.startDate, c.endDate);
  const sum = Number(c.monthlySalary ?? 0) * months + Number(c.signingBonus ?? 0);
  if (Number(c.totalValue) > 0 && Number(c.monthlySalary) > 0 && Math.abs(sum - Number(c.totalValue)) > Number(c.totalValue) * 0.05)
    warn.push(`الراتب الشهري × ${months} شهرًا + المقدم = ${money(sum.toFixed(2))} لا يساوي القيمة الإجمالية ${money(c.totalValue)}`);
  if (c.doc?.agent?.licenseExpiry && c.doc.agent.licenseExpiry < (c.doc.signDate || c.startDate)) warn.push("بطاقة الوكيل منتهية الصلاحية في تاريخ التوقيع");
  if (c.doc?.player.idExpiry && c.doc.player.idExpiry < (c.doc.signDate || c.startDate)) warn.push("وثيقة إثبات اللاعب منتهية الصلاحية في تاريخ التوقيع");

  return (
    <>
      <PageHead title={`عقد ${name} — ${club}`} sub={<><Badge v={CONTRACT_STATUS[c.status]} /> {c.number && <span className="kbd">رقم {c.number}</span>}</>}
        crumbs={[["عقود المحترفين", "/registration/contracts"], [name]]}
        actions={<>
          <Link className="btn btn-light" href={`/registration/requests/${c.registrationId}`}>طلب القيد {row.regNo ?? ""}</Link>
          <Link className="btn btn-light" href={`/print/contract/${c.id}`} target="_blank">🖨 طباعة</Link>
        </>} />
      <Flash sp={sp} />
      {warn.length > 0 && <div className="alert warn">⚠ للتدقيق:<ul>{warn.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <EContractSummary c={c} words={words} playerName={name} clubName={club} />
      <div className="card">
        <h3>النسخة الموقّعة من الطرفين</h3>
        {c.signedFileKey ? <p><a className="btn btn-light" href={fileUrl(c.signedFileKey)!} target="_blank">📎 فتح النسخة الموقّعة</a> <span className="muted">قارنها بالبيانات أعلاه (التوقيعات، البصمة، الختم)</span></p> : <p className="danger-text">لا توجد نسخة موقّعة</p>}
        {c.submittedAt && <p className="muted">أرسله النادي: {fmtDateTime(c.submittedAt)}</p>}
        {c.reviewedAt && <p className="muted">اعتمده: {c.reviewedBy} — {fmtDateTime(c.reviewedAt)}</p>}
        {c.terminatedAt && <p className="danger-text">أُنهي {fmtDateTime(c.terminatedAt)}: {c.terminationReason}</p>}
      </div>
      {c.status === "SUBMITTED" && row.regStatus !== "APPROVED" && (
        <div className="alert info">هذا العقد مرفق بطلب قيد ويُعتمد تلقائيًا عند اعتماد الطلب. <Link href={`/registration/requests/${c.registrationId}`}>فتح طلب القيد ←</Link></div>
      )}
      {c.status === "SUBMITTED" && row.regStatus === "APPROVED" && u.can("reg.review") && (
        <div className="grid g2">
          <form action={approveContract} className="card">
            <input type="hidden" name="id" value={c.id} />
            <h3>اعتماد العقد</h3>
            <p className="muted">يُمنح العقد رقمًا تسلسليًا{c.currency === "LYD" && Number(c.totalValue) > 0 ? `، وتُسجَّل رسوم 3% (${money((Number(c.totalValue) * 0.03).toFixed(2))}) مطالبةً على النادي` : ""}، وتُربط مدته بقيد اللاعب.</p>
            {miss.length > 0 && <p className="danger-text">ناقص: {miss.join("، ")}</p>}
            <Submit className="btn btn-primary" confirm="اعتماد العقد؟">✔ اعتماد العقد</Submit>
          </form>
          <form action={returnContract} className="card">
            <input type="hidden" name="id" value={c.id} />
            <h3>إعادة للنادي</h3>
            <Field label="ما المطلوب تصحيحه؟"><textarea name="note" rows={3} required /></Field>
            <Submit className="btn btn-light">↩ إعادة للاستكمال</Submit>
          </form>
        </div>
      )}
      {c.status === "ACTIVE" && u.can("reg.edit") && (
        <form action={terminateContract} className="card">
          <input type="hidden" name="id" value={c.id} />
          <h3>إنهاء العقد</h3>
          <Field label="السبب (فسخ بالتراضي، قرار لجنة، انتقال نهائي...)"><input name="reason" required /></Field>
          <Submit className="btn btn-light" confirm="تسجيل إنهاء هذا العقد؟">إنهاء العقد</Submit>
        </form>
      )}
    </>
  );
}
