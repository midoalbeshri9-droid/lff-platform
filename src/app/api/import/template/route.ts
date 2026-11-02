import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { IMPORT_COLS } from "@/lib/importCols";

export async function GET() {
  const u = await getCurrentUser();
  if (!u?.can("club.edit")) return new Response("غير مصرح", { status: 403 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("اللاعبون", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.addRow(IMPORT_COLS);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0EEE6" } };
  ws.addRow(["محمد علي أحمد الورفلي", "Mohamed Ali Elwarfalli", "120050012345", "", "2005-04-10", "طرابلس", "ليبي", "لا", "وسط", "هاو", "0912345678", 10]);
  IMPORT_COLS.forEach((_, i) => (ws.getColumn(i + 1).width = i === 0 ? 30 : 18));
  ws.getColumn(3).numFmt = "@";
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("نموذج-استيراد-اللاعبين.xlsx")}` },
  });
}
