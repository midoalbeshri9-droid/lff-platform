import "server-only";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { archiveDocs } from "@/db/schema";
import type { CurrentUser } from "./auth";
import { ROLE_COMMITTEE } from "./labels";

type Doc = { confidentiality: string; committee: string | null };

/** من يطّلع على الوثيقة: العامة لكل من لديه صلاحية الأرشيف، الخاصة بلجنة لأعضائها والأمانة، السرية لصلاحية «سري» فقط */
export function canSeeDoc(u: CurrentUser, d: Doc) {
  if (!u.can("archive.view")) return false;
  if (u.can("archive.secret")) return true;
  if (d.confidentiality === "SECRET") return false;
  if (d.confidentiality === "COMMITTEE") return !!d.committee && (ROLE_COMMITTEE[u.role] === d.committee || u.can("sec.manage"));
  return true;
}

/** شرط SQL لتصفية الوثائق المسموح بها للمستخدم */
export function visibleWhere(u: CurrentUser): SQL | undefined {
  if (u.can("archive.secret")) return undefined;
  const mine = ROLE_COMMITTEE[u.role];
  const committeeOk = u.can("sec.manage") ? sql`true` : mine ? eq(archiveDocs.committee, mine) : sql`false`;
  return or(eq(archiveDocs.confidentiality, "GENERAL"), and(eq(archiveDocs.confidentiality, "COMMITTEE"), committeeOk));
}

export const fmtSize = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.ceil(n / 1024)} ك.ب`);
