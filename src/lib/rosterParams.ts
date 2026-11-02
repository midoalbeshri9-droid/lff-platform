import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { listTemplates, settings } from "@/db/schema";
import { getCurrentUser } from "./auth";
import { getCurrentSeason } from "./registration";
import { DEFAULT_COLUMNS, ROSTER_COLUMNS } from "./roster";

/** يقرأ معاملات القائمة ويطبّق الصلاحيات: النادي يرى قائمته فقط */
export async function rosterParams(sp: URLSearchParams) {
  const u = await getCurrentUser();
  if (!u) return null;
  let clubIds = sp.getAll("club").map(Number).filter(Boolean);
  if (u.isClub) {
    if (!u.can("club.view")) return null;
    clubIds = [u.clubId!];
  } else if (!u.can("reg.lists")) return null;
  const seasonId = Number(sp.get("season")) || (await getCurrentSeason())?.id || 0;
  const categoryId = Number(sp.get("category")) || null;
  const tplId = Number(sp.get("template")) || null;
  const [tpl] = tplId ? await db.select().from(listTemplates).where(eq(listTemplates.id, tplId)) : [];
  let cols = tpl?.columns ?? sp.getAll("col");
  if (!cols.length) cols = DEFAULT_COLUMNS;
  const columns = cols.map((k) => ROSTER_COLUMNS.find((c) => c.key === k)).filter((c): c is (typeof ROSTER_COLUMNS)[number] => !!c);
  const opts = tpl?.options ?? {};
  const fed = Object.fromEntries((await db.select().from(settings)).map((s) => [s.key, s.value]));
  return {
    u, seasonId, clubIds, categoryId, columns,
    title: opts.title || "كشف اللاعبين المقيدين",
    landscape: opts.landscape || sp.get("landscape") === "1",
    stamp: !u.isClub && (opts.showStamp || sp.get("stamp") === "1"),
    signatures: opts.signatures?.length ? opts.signatures : ["رئيس لجنة القيد وأوضاع اللاعبين", "الأمين العام"],
    fedName: fed.federation_name ?? "الاتحاد الليبي لكرة القدم",
    fedNameEn: fed.federation_name_en ?? "Libyan Football Federation",
  };
}
