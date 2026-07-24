import { getAuthUser, unauthorized } from "@/lib/auth/session";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  return Response.json({
    id: user.id,
    username: user.username,
    role: user.role,
    isAdmin: user.role === "admin",
    impersonating: Boolean(user.impersonatorId),
    impersonatorUsername: user.impersonatorUsername ?? null,
  });
}
