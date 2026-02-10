import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/reset-password", "/favicon.ico"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))) return true;
  if (pathname.startsWith("/_next") || pathname.startsWith("/images")) return true;
  if (pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|webp)$/)) return true;
  return false;
}

function apiBaseUrl(): string {
  return (
    process.env.API_URL ??
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000"
  );
}

async function hasValidSession(req: NextRequest, apiBase: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: {
        cookie: req.headers.get("cookie") ?? ""
      },
      cache: "no-store",
      signal: controller.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function clearSessionCookie(resp: NextResponse): void {
  resp.cookies.set("mm_session", "", { path: "/", maxAge: 0 });
  const domain = process.env.COOKIE_DOMAIN?.trim();
  if (domain) {
    resp.cookies.set("mm_session", "", { path: "/", maxAge: 0, domain });
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get("mm_session");
  const apiBase = apiBaseUrl();

  if (isPublicPath(pathname)) {
    if ((pathname === "/login" || pathname === "/register" || pathname === "/reset-password") && session) {
      const valid = await hasValidSession(req, apiBase);
      if (valid) {
        const target = req.nextUrl.clone();
        target.pathname = "/";
        return NextResponse.redirect(target);
      }

      const resp = NextResponse.next();
      clearSessionCookie(resp);
      return resp;
    }
    return NextResponse.next();
  }

  if (!session) {
    const target = req.nextUrl.clone();
    target.pathname = "/login";
    return NextResponse.redirect(target);
  }

  const valid = await hasValidSession(req, apiBase);
  if (valid) return NextResponse.next();

  const target = req.nextUrl.clone();
  target.pathname = "/login";
  const resp = NextResponse.redirect(target);
  clearSessionCookie(resp);
  return resp;
}

export const config = {
  matcher: ["/((?!_next).*)"]
};
