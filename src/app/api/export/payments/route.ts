import ExcelJS from "exceljs";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { payments, clubs, officials, charges } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { PAY_METHOD, CHARGE_CATEGORY } from "@/lib/labels";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u?.can("fin.view")) return new Response("غير مصرح", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await db.select({ p: payments, club: clubs.name, off: officials.fullName, cat: charges.category, desc: charges.description }).from(payments)
    .innerJoin(charges, eq(charges.id, payments.chargeId)).leftJoin(clubs, eq(clubs.id, payments.clubId)).leftJoin(officials, eq(officials.id, payments.officialId))
    .where(and(sp.get("dir") ? eq(payments.direction, sp.get("dir") as "IN") : undefined, sp.get("from") ? gte(payments.date, sp.get("from")!) : undefined, sp.get("to") ? lte(payments.date, sp.get("to")!) : undefined))
    .orderBy(desc(payments.id));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("الإيصالات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.addRow(["الرقم", "التاريخ", "النوع", "الجهة", "البند", "البيان", "المبلغ", "الطريقة", "المرجع", "بواسطة", "ملغى"]);
  ws.getRow(1).font = { bold: true };
  rows.forEach(({ p, club, off, cat, desc: d }) => ws.addRow([p.receiptNo, p.date, p.direction === "IN" ? "استلام" : "صرف", club ?? off, CHARGE_CATEGORY[cat] ?? cat, d, Number(p.amount), PAY_METHOD[p.method], p.reference, p.receivedBy, p.isVoided ? "نعم" : ""]));
  [14, 12, 10, 24, 18, 40, 12, 14, 16, 18, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("الإيصالات.xlsx")}` } });
}
