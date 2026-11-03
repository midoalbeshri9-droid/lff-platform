import { appUrl } from "@/lib/tokens";
import { redirect } from "next/navigation";
import { eq, inArray, desc } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db";
import { registrations, players, clubs, seasons, ageCategories, cardTemplates, settings } from "@/db/schema";
import { scopeOf } from "@/lib/scope";
import { getCurrentUser } from "@/lib/auth";
import { POSITION, PRO_LEVEL, REG_TYPE } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { CardFace } from "@/components/CardFace";
import { PrintCardsBar } from "@/components/PrintCards";

export const metadata = { title: "طباعة البطاقات" };

export default async function PrintCards({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const u = await getCurrentUser();
  if (!u || !u.can("cards.print")) redirect("/denied");
  const sp = await searchParams;
  const ids = (Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : []).map(Number).filter(Boolean);
  const side = (sp.side as string) ?? "front";
  const tplId = Number(sp.template);
  const [tpl] = tplId ? await db.select().from(cardTemplates).where(eq(cardTemplates.id, tplId))
    : await db.select().from(cardTemplates).orderBy(desc(cardTemplates.isDefault)).limit(1);
  if (!tpl) redirect("/registration/cards/templates");
  if (!ids.length) return <p style={{ padding: 30 }}>لم يتم اختيار أي لاعب. أغلق النافذة واختر اللاعبين.</p>;
  const fed = Object.fromEntries((await db.select().from(settings)).map((s) => [s.key, s.value]));
  const rows = await db
    .select({ r: registrations, p: players, club: clubs, season: seasons, cat: ageCategories.name })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId)).leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(inArray(registrations.id, ids));
  const sc = await scopeOf(u);
  const ok = rows.filter((x) => x.r.status === "APPROVED" && (!sc || sc.clubIds.includes(x.r.clubId)));
  const base = appUrl();
  const cards = await Promise.all(ok.map(async ({ r, p, club, season, cat }) => ({
    id: r.id,
    photo: fileUrl(p.photoKey),
    qr: await QRCode.toDataURL(`${base}/verify/${r.verifyToken}`, { margin: 0, width: 300, errorCorrectionLevel: "M" }),
    data: {
      fullName: p.fullName, fullNameEn: p.fullNameEn ?? "", club: club.name, clubEn: club.nameEn ?? "", number: r.number ?? "", cardNo: p.cardNo ?? "",
      season: season.name, category: cat ?? "", dob: fmtDate(p.dateOfBirth), birthYear: p.dateOfBirth.slice(0, 4), nationalId: p.nationalId ?? "",
      nationality: p.nationality, position: POSITION[p.position], shirt: r.shirtNumber ? String(r.shirtNumber) : "", level: PRO_LEVEL[p.professionalLevel],
      regType: REG_TYPE[r.type], approvedAt: r.decidedAt ? fmtDate(r.decidedAt) : "", validUntil: fmtDate(season.endDate),
      fedName: fed.federation_name ?? "الاتحاد الليبي لكرة القدم",
    } as Record<string, string>,
  })));
  const faces: ("front" | "back")[] = side === "both" ? ["front", "back"] : side === "back" ? ["back"] : ["front"];
  return (
    <div className="card-print-root">
      <style>{`@page { size: ${tpl.widthMm}mm ${tpl.heightMm}mm; margin: 0; } @media print { html, body { margin: 0; } }`}</style>
      <PrintCardsBar ids={cards.map((c) => c.id)} templateId={tpl.id} replacement={sp.replacement === "1"} count={cards.length} />
      {ok.length < ids.length && <p className="no-print danger-text" style={{ textAlign: "center" }}>تم تجاهل {ids.length - ok.length} قيد غير معتمد.</p>}
      {cards.map((c) => faces.map((f) => (
        <div key={`${c.id}-${f}`} className="cr80" style={{ width: `${tpl.widthMm}mm`, height: `${tpl.heightMm}mm` }}>
          <CardFace els={(f === "front" ? tpl.front : tpl.back) ?? []} w={tpl.widthMm} h={tpl.heightMm}
            bg={(f === "front" ? tpl.frontBg : tpl.backBg) ? `/api/files/${f === "front" ? tpl.frontBg : tpl.backBg}` : null}
            data={c.data} photo={c.photo} qr={c.qr} className="" />
        </div>
      )))}
    </div>
  );
}
