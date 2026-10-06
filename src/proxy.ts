import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, verifyImpersonation } from "@/lib/auth/jwt";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-cookie";
import { isInternalApiPath, loginUrl, LOGIN_PATH } from "@/lib/routes";

const PUBLIC_PATHS = [LOGIN_PATH, "/register"];
const ADMIN_API_PREFIX = "/api/admin/";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/register")
  ) {
    return NextResponse.next();
  }

  // Machine-to-machine endpoints have no session cookie to check — the handler
  // authenticates the shared scheduler secret itself, and 404s when no secret
  // is configured so the surface does not exist by default.
  if (isInternalApiPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Keep where they were going (an invite link, a shared conversation).
    const back = pathname + request.nextUrl.search;
    return NextResponse.redirect(
      new URL(pathname === "/" ? LOGIN_PATH : loginUrl(back), request.url),
    );
  }

  const isApi = pathname.startsWith("/api/");
  // No admin guard here any more: the console is also open to org owners/admins,
  // and an org role is deliberately not in the JWT (it is re-read per request).
  // The admin layout and every /api/admin handler gate it themselves
  // (getConsoleContext / getAdminActor) — docs/DECISIONS.md 125.

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
        pathname.startsWith(ADMIN_API_PREFIX) ||
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
