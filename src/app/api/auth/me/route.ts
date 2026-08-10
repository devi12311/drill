import { getSessionUser, unauthorized } from "@/lib/auth/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return Response.json(user);
}
