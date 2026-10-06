import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext, getAuthUser } from "@/lib/auth/session";
import { NewOrgForm } from "@/components/orgs/new-org-dialog";
import { LogoutLink } from "@/components/orgs/logout-link";
import { StandaloneCard } from "@/components/orgs/standalone-card";
import { LOGIN_PATH } from "@/lib/routes";

export const metadata: Metadata = { title: "No organization · Drill" };

/**
 * Where a signed-in user who belongs to no org lands (they left, or were removed
 * from, their last one). Without it the shell would bounce them to login and
 * login straight back — a loop with no way out.
 */
export default async function NoOrgPage() {
  if (!(await getAuthUser())) redirect(LOGIN_PATH);
  if (await getAuthContext()) redirect("/");
  return (
    <StandaloneCard title="You are not in an organization">
      <p className="text-body-sm text-pale-stone">
        Start a new one, or open an invitation link someone sent you.
      </p>
      <NewOrgForm />
      <p className="text-body-sm text-bone-gray">
        <LogoutLink />
      </p>
    </StandaloneCard>
  );
}
