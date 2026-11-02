import { verifyByToken } from "@/lib/eligibility";
import { readObject, mimeOf } from "@/lib/storage";

// صورة اللاعب لصفحة التحقق العامة فقط (عبر رمز البطاقة)
export async function GET(_r: Request, { params }: { params: Promise<{ token: string }> }) {
  const r = await verifyByToken((await params).token);
  if (!r?.player.photoKey) return new Response("not found", { status: 404 });
  const buf = await readObject(r.player.photoKey);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": mimeOf(r.player.photoKey), "Cache-Control": "private, max-age=600" } });
}
