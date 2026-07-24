import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, verifyImpersonation } from "@/lib/auth/jwt";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-cookie";

const PUBLIC_PATHS = ["/login", "/register"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/register")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const isApi = pathname.startsWith("/api/");
  const isAdminPath =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/");

  // Admin guard (edge check off the JWT role claim; handlers re-check via
  // requireAdmin/getAdminActor for defense in depth).
  if (isAdminPath && session.role !== "admin") {
    if (isApi) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Read-only impersonation choke point: while an admin is impersonating, block
  // every mutating request to the impersonated user's surface in one place — so
  // no costly investigation (POST /api/chat) or delete runs as that user. Admin
  // controls (/api/admin/*, incl. Stop) and logout stay allowed.
  if (isApi && request.method !== "GET") {
    const impToken = request.cookies.get(IMPERSONATION_COOKIE)?.value;
    if (impToken && session.role === "admin") {
      const decoded = await verifyImpersonation(impToken);
      const impersonating = decoded != null && decoded.actor === session.sub;
      const allowed =
        pathname.startsWith("/api/admin/") ||
        pathname.startsWith("/api/auth/logout");
      if (impersonating && !allowed) {
        return NextResponse.json(
          { error: "Read-only while impersonating" },
          { status: 403 },
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
