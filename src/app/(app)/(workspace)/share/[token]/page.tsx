import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import {
  findLiveShareLink,
  listRedemptions,
  skillNameTaken,
  sourceInReach,
  type OpenedShareLink,
} from "@/lib/db/share-queries";
import { isOrgAdmin } from "@/lib/orgs/types";
import { LOGIN_PATH } from "@/lib/routes";
import { SHARE_GONE_MESSAGE } from "@/lib/share/access";
import { ShareReview, type ShareTarget } from "@/components/share/share-review";

export const metadata: Metadata = { title: "Shared with you · Drill" };

/**
 * `/share/<token>` — review a shared skill or resolution, then import a copy or
 * not. Rendering changes nothing (chat apps prefetch links to unfurl them);
 * import and decline are POSTs from the page.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getAuthContext();
  // The shell already sent signed-out and org-less visitors away; this is its type guard.
  if (!ctx) redirect(LOGIN_PATH);
  const orgIds = ctx.memberships.map((m) => m.orgId);
  const link = await findLiveShareLink(token, orgIds);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 pb-20 pt-8">
        {link ? await review(link, token, ctx) : <Gone />}
      </div>
    </main>
  );
}

async function review(link: OpenedShareLink, token: string, ctx: AuthContext) {
  const orgIds = ctx.memberships.map((m) => m.orgId);
  const { payload } = link;
  const skillName = payload.kind === "skill" ? payload.draft.name : null;
  const [redemptions, inReach, taken] = await Promise.all([
    listRedemptions(link, ctx.userId),
    sourceInReach(link, ctx.userId, orgIds),
    skillName ? Promise.all(orgIds.map((id) => skillNameTaken(id, skillName))) : null,
  ]);
  const targets: ShareTarget[] = ctx.memberships.map((m, i) => {
    const r = redemptions.find((x) => x.targetOrgId === m.orgId);
    return {
      orgId: m.orgId,
      orgName: m.orgName,
      isAdmin: isOrgAdmin(m.role),
      nameTaken: taken?.[i] ?? false,
      redemption: r
        ? {
            status: r.status,
            importedId: r.importedId,
            copyExists: r.copyExists,
            at: r.updatedAt.toISOString(),
          }
        : null,
    };
  });
  // The active org, unless a resolution needs an org the viewer administers.
  const eligible = (t: ShareTarget) => link.kind === "skill" || t.isAdmin;
  const active = targets.find((t) => t.orgId === ctx.orgId)!;
  const defaultOrgId = (eligible(active) ? active : (targets.find(eligible) ?? active)).orgId;

  return (
    <ShareReview
      token={token}
      payload={payload}
      fromOrg={link.orgName}
      author={link.author}
      sharedAt={link.createdAt.toISOString()}
      external={!orgIds.includes(link.orgId)}
      inReachId={inReach ? link.sourceId : null}
      targets={targets}
      defaultOrgId={defaultOrgId}
      activeOrgId={ctx.orgId}
    />
  );
}

function Gone() {
  return (
    <div className="mx-auto mt-16 max-w-[420px] space-y-3 rounded-lg border border-border bg-smoked-onyx p-6">
      <h1 className="text-heading-sm text-warm-off-white">This link is no longer valid</h1>
      <p className="text-body-sm text-pale-stone">
        {SHARE_GONE_MESSAGE}. Ask whoever sent it for a new one.
      </p>
      <Link href="/skills" className="inline-block text-body-sm text-bone-gray hover:text-warm-off-white">
        Go to your skills
      </Link>
    </div>
  );
}
