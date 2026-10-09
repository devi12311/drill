"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { CopyField } from "@/components/ui/copy-field";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/components/session/session-provider";
import { formatDateTime, formatRelative } from "@/lib/admin/format";
import {
  assignableRoles,
  canManageMember,
  ORG_NAME_MAX,
  ORG_ROLE_LABEL,
  type OrgInviteView,
  type OrgMemberView,
  type OrgRole,
} from "@/lib/orgs/types";
import { invitePath } from "@/lib/routes";
import { sendJson } from "@/lib/http";
import { reloadInto } from "./org-actions";
import { ShareLinkRow } from "@/components/share/share-dialog";
import type { ShareLinkView } from "@/lib/share/types";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-smoked-onyx p-5">
      <h2 className="text-subheading text-warm-off-white">{title}</h2>
      {description && (
        <p className="mt-1 max-w-[62ch] text-body-sm text-bone-gray">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Runs one mutation at a time and reports its failure next to the control that
 * caused it. On success the server page is re-rendered (`router.refresh`), which
 * also refreshes the session — so a rename shows in the sidebar at once.
 */
function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      router.refresh();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }
  /** The last failure, shown under the section (one mutation runs at a time). */
  const errorLine = error ? (
    <p role="alert" className="mt-2 text-body-sm text-traffic-red">
      {error}
    </p>
  ) : null;
  return { busy, run, errorLine };
}

export function OrgSettings({
  members,
  invites,
  shareLinks,
}: {
  members: OrgMemberView[];
  invites: OrgInviteView[];
  shareLinks: ShareLinkView[];
}) {
  const { user } = useSession();
  const { org, isOrgAdmin } = user;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] space-y-6 px-6 pb-20 pt-8">
        <div>
          <div className="text-caption-tracked uppercase text-bone-gray">Organization</div>
          <h1 className="mt-2 break-words text-heading text-warm-off-white">{org.name}</h1>
          <p className="mt-1 max-w-[62ch] text-body text-pale-stone">
            Everyone here shares the same Holmes agents, monitored clusters, shared
            skills and resolutions. Your conversations stay private to you. You are{" "}
            {org.role === "admin" ? "an" : "a"} {ORG_ROLE_LABEL[org.role].toLowerCase()}.
          </p>
        </div>

        {isOrgAdmin && <RenameOrg current={org.name} />}
        <Members members={members} />
        {isOrgAdmin && <Invites invites={invites} />}
        {shareLinks.length > 0 && <ShareLinks links={shareLinks} isOrgAdmin={isOrgAdmin} />}
      </div>
    </main>
  );
}

function RenameOrg({ current }: { current: string }) {
  const [name, setName] = useState(current);
  const { busy, run, errorLine } = useMutation();
  const dirty = name.trim() !== current && name.trim() !== "";
  return (
    <Section title="Name">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run("rename", () => sendJson("/api/org", { name }, "PATCH"));
        }}
      >
        <Input
          aria-label="Organization name"
          maxLength={ORG_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={!dirty || busy !== null}>
          {busy === "rename" ? "Saving…" : "Save"}
        </Button>
      </form>
      {errorLine}
    </Section>
  );
}

function Members({ members }: { members: OrgMemberView[] }) {
  const { user } = useSession();
  const pathname = usePathname();
  const { busy, run, errorLine } = useMutation();
  const actor = user.org.role;
  const roles = assignableRoles(actor);

  return (
    <Section
      title={`Members · ${members.length}`}
      description="Owners and admins manage agents, clusters and shared skills. Admins cannot change owners."
    >
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const self = m.userId === user.id;
          const manageable = !self && canManageMember(actor, m.role);
          return (
            <li key={m.userId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-body-sm text-warm-off-white">
                  {m.username}
                  {self && <span className="ml-2 font-sans text-bone-gray">(you)</span>}
                </div>
                <div className="text-[12px] text-bone-gray">
                  joined {formatRelative(m.joinedAt)}
                </div>
              </div>
              {manageable ? (
                <select
                  aria-label={`Role of ${m.username}`}
                  value={m.role}
                  disabled={busy !== null}
                  onChange={(e) =>
                    run(m.userId, () =>
                      sendJson(`/api/org/members/${m.userId}`, { role: e.target.value }, "PATCH"),
                    )
                  }
                  className={cn(NATIVE_SELECT_CLASS, "h-8")}
                >
                  {/* The current role is always listed, even one this actor could not grant. */}
                  {[...new Set<OrgRole>([m.role, ...roles])].map((r) => (
                    <option key={r} value={r}>
                      {ORG_ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-body-sm text-pale-stone">{ORG_ROLE_LABEL[m.role]}</span>
              )}
              {manageable && (
                <ConfirmButton
                  label={`Remove ${m.username}`}
                  title={`Remove ${m.username}?`}
                  description="They lose access to this organization's agents, skills and resolutions at once. Their private conversations here stay, but they can no longer open them."
                  confirmLabel="Remove"
                  destructive
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy !== null}
                  className="text-pale-stone hover:text-traffic-red"
                  onConfirm={() =>
                    run(m.userId, () => sendJson(`/api/org/members/${m.userId}`, {}, "DELETE"))
                  }
                >
                  <X className="size-3.5" />
                </ConfirmButton>
              )}
              {self && (
                <ConfirmButton
                  label="Leave organization"
                  title={`Leave ${user.org.name}?`}
                  description="You lose access at once and need a new invitation to come back."
                  confirmLabel="Leave"
                  destructive
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onConfirm={async () => {
                    const left = await run("leave", () =>
                      sendJson(`/api/org/members/${m.userId}`, {}, "DELETE"),
                    );
                    if (left) reloadInto(pathname);
                  }}
                >
                  Leave
                </ConfirmButton>
              )}
            </li>
          );
        })}
      </ul>
      {errorLine}
    </Section>
  );
}

function Invites({ invites }: { invites: OrgInviteView[] }) {
  const { user } = useSession();
  const roles = assignableRoles(user.org.role);
  const [role, setRole] = useState<OrgRole>("member");
  const [label, setLabel] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const { busy, run, errorLine } = useMutation();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const invite = await run("create", () =>
      sendJson("/api/org/invites", { role, label }) as Promise<{ token: string }>,
    );
    if (invite) {
      setLink(`${window.location.origin}${invitePath(invite.token)}`);
      setLabel("");
    }
  }

  return (
    <Section
      title="Invite people"
      description="An invite is a single-use link that expires in 7 days. Whoever opens it signs in, or creates an account with a username of their choosing, and joins. Drill shows it only once, so copy it now."
    >
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1 space-y-2">
          <Label htmlFor="invite-label" className="text-pale-stone">
            Note <span className="text-bone-gray">(optional, only admins see it)</span>
          </Label>
          <Input
            id="invite-label"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ana, on-call rotation"
          />
        </div>
        <select
          aria-label="Role for the invitee"
          value={role}
          onChange={(e) => setRole(e.target.value as OrgRole)}
          className={NATIVE_SELECT_CLASS}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ORG_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" disabled={busy !== null} className="gap-2">
          <Link2 className="size-4" />
          {busy === "create" ? "Creating…" : "Create link"}
        </Button>
      </form>
      {errorLine}

      {link && (
        <div className="mt-4">
          <CopyField value={link} />
        </div>
      )}

      {invites.length > 0 && (
        <>
          <div className="mt-6 text-caption-tracked uppercase text-bone-gray">Pending</div>
          <ul className="mt-2 divide-y divide-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body-sm text-warm-off-white">
                    {inv.label ?? "No note"}
                  </div>
                  <div className="text-[12px] text-bone-gray">
                    {ORG_ROLE_LABEL[inv.role]} · by {inv.createdByName ?? "former member"} ·
                    expires {formatDateTime(inv.expiresAt)}
                  </div>
                </div>
                <ConfirmButton
                  label="Revoke invite"
                  title="Revoke this invite?"
                  description="The link stops working immediately."
                  confirmLabel="Revoke"
                  destructive
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onConfirm={() =>
                    run(inv.id, () => sendJson(`/api/org/invites/${inv.id}`, {}, "DELETE"))
                  }
                >
                  Revoke
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/** Live share links: create them from a skill or resolution, revoke them here too. */
function ShareLinks({ links, isOrgAdmin }: { links: ShareLinkView[]; isOrgAdmin: boolean }) {
  const router = useRouter();
  return (
    <Section
      title="Share links"
      description={
        isOrgAdmin
          ? "Every live link that hands this organization's skills and resolutions to someone. Revoking stops new imports; copies already made stay where they are."
          : "Links you created to share your skills. Revoking stops new imports; copies already made stay where they are."
      }
    >
      <ul className="divide-y divide-border">
        {links.map((l) => (
          <ShareLinkRow key={l.id} link={l} showTitle onRevoked={() => router.refresh()} />
        ))}
      </ul>
    </Section>
  );
}
