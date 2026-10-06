import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { findPendingInvite } from "@/lib/db/org-queries";
import { AcceptInvite } from "@/components/orgs/accept-invite";
import { LogoutLink } from "@/components/orgs/logout-link";
import { StandaloneCard } from "@/components/orgs/standalone-card";
import { loginUrl } from "@/lib/routes";
import { ORG_ROLE_LABEL } from "@/lib/orgs/types";

export const metadata: Metadata = { title: "Invitation · Drill" };

/**
 * An invitation link. Outside the app shell on purpose: the invitee may belong
 * to no org yet. Opening it changes nothing — joining is an explicit click, so a
 * link previewed by a chat app's unfurler cannot spend the invitation.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getAuthUser();
  if (!user) redirect(loginUrl(`/invite/${token}`));
  const invite = await findPendingInvite(token);

  if (!invite) {
    return (
      <StandaloneCard title="This invitation is no longer valid">
        <p className="text-body-sm text-pale-stone">
          It has expired, already been used, or been revoked. Ask whoever sent it
          for a new link.
        </p>
        <Link
          href="/"
          className="text-body-sm text-pale-stone underline underline-offset-4 hover:text-warm-off-white"
        >
          Go to Drill
        </Link>
      </StandaloneCard>
    );
  }

  return (
    <StandaloneCard title={`Join ${invite.orgName}`}>
      <p className="text-body-sm text-pale-stone">
        {invite.invitedBy ?? "Someone"} invited you to join as{" "}
        {ORG_ROLE_LABEL[invite.role].toLowerCase()}. You will share its Holmes
        agents, skills and resolutions; your own conversations stay private.
      </p>
      <AcceptInvite token={token} orgName={invite.orgName} />
      <p className="text-body-sm text-bone-gray">
        Signed in as <span className="font-mono text-pale-stone">{user.username}</span>.
        Not you? <LogoutLink label="Switch account" />
      </p>
    </StandaloneCard>
  );
}
