"use server";
import { requireUser } from "@/lib/auth";
import { guard, inScopePlayer } from "@/lib/scope";
import { attempt, int, UserError } from "@/lib/util";
import { audit } from "@/lib/audit";
import { mergePlayers } from "@/lib/merge";

export async function doMerge(f: FormData) {
  const u = await requireUser("reg.edit");
  const masterId = int(f, "master")!, dupId = int(f, "dup")!;
  await attempt(`/registration/players/${masterId}`, async () => {
    if (String(f.get("confirm") ?? "").trim() !== "دمج") throw new UserError("اكتب كلمة «دمج» للتأكيد");
    guard((await inScopePlayer(u, masterId)) && (await inScopePlayer(u, dupId)));
    const r = await mergePlayers(masterId, dupId, u.fullName);
    await audit(u, "دمج سجل لاعب مكرر", "Player", masterId, { merged: JSON.parse(r.snapshot), filled: r.filled });
    return `تم الدمج — نُقلت كل القيود والأحداث والعقوبات إلى هذا الملف${r.filled.length ? ` وأُكملت ${r.filled.length} من البيانات الناقصة` : ""}`;
  });
}

