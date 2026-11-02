import { eq, and, or } from "drizzle-orm";
import { db } from "@/db";
import { registrationDocuments, registrations, players } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { readObject, mimeOf } from "@/lib/storage";

/** تنزيل الملفات مع فحص الصلاحية: النادي يرى ملفات لاعبيه فقط */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const key = (await params).key.map(decodeURIComponent).join("/");
  if (key.includes("..")) return new Response("bad", { status: 400 });

  let allowed = false;
  if (key.startsWith("cards/")) allowed = true; // خلفيات البطاقات
  else if (!u.isClub && !u.isOfficial) allowed = u.canAny("reg.view", "comp.view", "cards.print", "ref.view");
  else if (u.isClub) {
    if (key.startsWith(`docs/${u.clubId}/`)) {
      const [d] = await db.select({ id: registrationDocuments.id }).from(registrationDocuments)
        .innerJoin(registrations, eq(registrations.id, registrationDocuments.registrationId))
        .where(and(eq(registrationDocuments.fileKey, key), eq(registrations.clubId, u.clubId!)));
      allowed = !!d;
    } else if (key.startsWith("photos/")) {
      const [p] = await db.select({ id: players.id }).from(players)
        .leftJoin(registrations, eq(registrations.playerId, players.id))
        .where(and(eq(players.photoKey, key), or(eq(registrations.clubId, u.clubId!), eq(registrations.fromClubId, u.clubId!), eq(players.createdByClubId, u.clubId!))))
        .limit(1);
      allowed = !!p;
    }
  }
  if (!allowed) return new Response("forbidden", { status: 403 });
  const buf = await readObject(key);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": mimeOf(key), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
