import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/login", "/verify", "/activate", "/forgot", "/reset", "/confirm-email", "/_next", "/img", "/fonts", "/favicon.ico", "/api/health"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.set("x-path", pathname);
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers } });
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
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
