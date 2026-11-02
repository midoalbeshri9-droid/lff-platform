import ExcelJS from "exceljs";
import { rosterParams } from "@/lib/rosterParams";
import { loadRoster } from "@/lib/roster";

async function handle(sp: URLSearchParams) {
  const P = await rosterParams(sp);
  if (!P) return new Response("غير مصرح", { status: 403 });
  const data = await loadRoster(P.seasonId, P.clubIds, P.categoryId);
  const cols = P.columns.filter((c) => c.key !== "photo" && c.key !== "signature");
  const wb = new ExcelJS.Workbook();
  wb.creator = P.fedName;
  const add = (name: string, rows: typeof data.rows) => {
    const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
    ws.mergeCells(1, 1, 1, cols.length);
    ws.getCell(1, 1).value = `${P.title} — ${name} — الموسم ${data.season?.name ?? ""}`;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getRow(3).values = cols.map((c) => c.label);
    ws.getRow(3).font = { bold: true };
    ws.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0EEE6" } };
    rows.forEach((x, i) => ws.addRow(cols.map((c) => c.get(x, i))));
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.key === "fullName" || c.key === "fullNameEn" ? 32 : 16));
  };
  if (data.groups.length > 1) add("كل الأندية", data.rows);
  data.groups.forEach((g) => add(g.club.name, g.rows));
  if (!data.groups.length) add("فارغ", []);
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`قوائم-الفرق-${data.season?.name ?? ""}.xlsx`)}`,
    },
  });
}

export async function GET(req: Request) {
  return handle(new URL(req.url).searchParams);
}
export async function POST(req: Request) {
  const f = await req.formData();
  const sp = new URLSearchParams();
  f.forEach((v, k) => typeof v === "string" && sp.append(k, v));
  return handle(sp);
}
