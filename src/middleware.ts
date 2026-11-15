import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/api/backup", "/league", "/login", "/verify", "/activate", "/forgot", "/reset", "/confirm-email", "/_next", "/img", "/fonts", "/favicon.ico", "/api/health"];

/** رؤوس الحماية لكل الصفحات (العامة والداخلية) */
function secure(res: NextResponse, pathname: string) {
  // نوافذ الدوري مصمَّمة للتضمين في مواقع أخرى؛ ما عداها لا يُعرض داخل إطار موقع آخر (منع خداع النقر)
  const embeddable = pathname.startsWith("/league/widget");
  if (!embeddable) res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Content-Security-Policy", `${embeddable ? "frame-ancestors *" : "frame-ancestors 'self'"}; object-src 'none'; base-uri 'self'; form-action 'self'`);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.set("x-path", pathname);
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p))) {
    return secure(NextResponse.next({ request: { headers } }), pathname);
  }
  const token = req.cookies.get("lff_session")?.value;
  let ok = false;
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET!));
      ok = true;
    } catch {}
  }
  if (!ok) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return secure(NextResponse.next({ request: { headers } }), pathname);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
