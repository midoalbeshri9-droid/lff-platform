import "server-only";
import { and, eq, desc, asc } from "drizzle-orm";
import { db } from "@/db";
import { registrations, registrationDocuments, registrationEvents, documentTypes, clubs, seasons, players, ageCategories, cardPrints, contracts } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { requiredDocTypes, activeSuspensions } from "./registration";

export async function loadRegistration(id: number) {
  const fc = alias(clubs, "fc");
  const [row] = await db
    .select({ r: registrations, p: players, club: clubs, season: seasons, cat: ageCategories.name, fromClub: fc.name })
    .from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .leftJoin(fc, eq(fc.id, registrations.fromClubId))
    .where(eq(registrations.id, id));
  if (!row) return null;
  const [docs, events, required, allTypes, susp, prints, contractRows] = await Promise.all([
    db.select({ d: registrationDocuments, type: documentTypes.name })
      .from(registrationDocuments).innerJoin(documentTypes, eq(documentTypes.id, registrationDocuments.documentTypeId))
      .where(eq(registrationDocuments.registrationId, id)).orderBy(asc(documentTypes.sortOrder), desc(registrationDocuments.id)),
    db.select().from(registrationEvents).where(eq(registrationEvents.registrationId, id)).orderBy(desc(registrationEvents.at)),
    requiredDocTypes(row.r.type, row.p),
    db.select().from(documentTypes).where(and(eq(documentTypes.isActive, true), eq(documentTypes.scope, "PLAYER"))).orderBy(documentTypes.sortOrder),
    activeSuspensions(row.p.id),
    db.select().from(cardPrints).where(eq(cardPrints.registrationId, id)).orderBy(desc(cardPrints.printedAt)),
    db.select().from(contracts).where(eq(contracts.registrationId, id)),
  ]);
  return { ...row, docs, events, required, allTypes, susp, prints, contract: contractRows[0] ?? null };
}
export type RegFull = NonNullable<Awaited<ReturnType<typeof loadRegistration>>>;
