import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/favicon.ico"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))) return true;
  if (pathname.startsWith("/_next") || pathname.startsWith("/images")) return true;
  if (pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|webp)$/)) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get("mm_session");

  if (isPublicPath(pathname)) {
    if ((pathname === "/login" || pathname === "/register") && session) {
      const target = req.nextUrl.clone();
      target.pathname = "/";
      return NextResponse.redirect(target);
    }
    return NextResponse.next();
  }

  if (!session) {
    const target = req.nextUrl.clone();
    target.pathname = "/login";
    return NextResponse.redirect(target);
  }

  const apiBase =
    process.env.API_URL ??
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000";

  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: {
        cookie: req.headers.get("cookie") ?? "",
        origin: req.nextUrl.origin
      },
      cache: "no-store"
    });
    if (res.ok) return NextResponse.next();
  } catch {
    // handled by redirect below
  }

  const target = req.nextUrl.clone();
  target.pathname = "/login";
  const resp = NextResponse.redirect(target);
  resp.cookies.set("mm_session", "", { path: "/", maxAge: 0 });
  return resp;
}

export const config = {
  matcher: ["/((?!_next).*)"]
};
