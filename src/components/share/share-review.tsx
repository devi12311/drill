"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { ArtifactForm } from "@/components/resolutions/artifact-form";
import { SkillEditor } from "@/components/skills/skill-editor";
import { formatDateTime } from "@/lib/admin/format";
import type { ArtifactDraft } from "@/lib/artifacts/types";
import type { SkillDraft } from "@/lib/skills/types";
import type { RedemptionStatus, SharePayload } from "@/lib/share/types";

export interface ShareTarget {
  orgId: string;
  orgName: string;
  /** May import a resolution into it (its owner/admin). */
  isAdmin: boolean;
  /** The shared skill's name is already used there. */
  nameTaken: boolean;
  redemption: {
    status: RedemptionStatus;
    importedId: string | null;
    /** False once the imported copy was deleted — importing again is then allowed. */
    copyExists: boolean;
    at: string;
  } | null;
}

const itemHref = (kind: SharePayload["kind"], id: string) =>
  kind === "skill" ? `/skills/${id}` : `/resolutions/${id}`;

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * The recipient's side of a share link: the shared draft in the usual editor,
 * editable, then Import (a private copy in the chosen org) or Not now — which
 * keeps the link usable, so they can come back and import later.
 */
export function ShareReview({
  token,
  payload,
  fromOrg,
  author,
  sharedAt,
  external,
  inReachId,
  targets,
  defaultOrgId,
  activeOrgId,
}: {
  token: string;
  payload: SharePayload;
  fromOrg: string;
  author: string | null;
  sharedAt: string;
  /** Shared from an org the viewer is not in. */
  external: boolean;
  /** The original is already within the viewer's reach — its id in the source org. */
  inReachId: string | null;
  targets: ShareTarget[];
  defaultOrgId: string;
  activeOrgId: string;
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(defaultOrgId);
  // Names the server refused since the page loaded (someone took it meanwhile).
  const [refused, setRefused] = useState<Record<string, string>>({});
  const target = targets.find((t) => t.orgId === orgId) ?? targets[0];
  const { kind } = payload;
  // Only a copy that still exists blocks importing again.
  const imported =
    target.redemption?.status === "imported" && target.redemption.copyExists
      ? target.redemption
      : null;
  const mayImport = !imported && (kind === "skill" || target.isAdmin);

  async function importDraft(draft: SkillDraft | ArtifactDraft) {
    const { ok, status, data } = await post(`/api/share/${encodeURIComponent(token)}/import`, {
      orgId: target.orgId,
      draft,
    });
    if (status === 409 && data.field === "name") {
      setRefused((r) => ({ ...r, [target.orgId]: (draft as SkillDraft).name }));
      return;
    }
    if (!ok) throw new Error(data.error ?? `HTTP ${status}`);
    const href = itemHref(kind, data.id);
    // Into another org, the server switched the active one: a full load, so the
    // shell's session and lists are that org's (as `reloadInto` does).
    if (target.orgId !== activeOrgId) window.location.assign(href);
    else router.push(href);
  }

  async function decline() {
    await post(`/api/share/${encodeURIComponent(token)}/decline`, { orgId: target.orgId });
    router.push(kind === "skill" ? "/skills" : "/resolutions");
  }

  const picker =
    targets.length > 1 ? (
      <select
        aria-label="Organization to import into"
        value={target.orgId}
        onChange={(e) => setOrgId(e.target.value)}
        className={NATIVE_SELECT_CLASS}
      >
        {targets.map((t) => (
          <option key={t.orgId} value={t.orgId}>
            into {t.orgName}
          </option>
        ))}
      </select>
    ) : (
      <span className="text-body-sm text-bone-gray">into {target.orgName}</span>
    );

  const notNow = (
    <Button variant="ghost" onClick={decline}>
      Not now
    </Button>
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="text-caption-tracked uppercase text-bone-gray">
          Shared {kind} · from {fromOrg}
          {author && <span className="normal-case tracking-normal"> · by @{author}</span>} ·{" "}
          {formatDateTime(sharedAt)}
        </div>
        {external && (
          <p className="flex gap-2.5 rounded-lg border border-border bg-smoked-onyx px-4 py-3 text-body-sm text-pale-stone">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-traffic-yellow" />
            <span>
              {kind === "skill"
                ? "Written outside your organization. A skill steers how Holmes investigates — read the whole procedure before importing. It arrives private to you; only an admin can share it with your org."
                : "Written outside your organization. An imported resolution joins your org's knowledge base and is searched in every member's investigations — read it before importing."}
            </span>
          </p>
        )}
        {inReachId && (
          <p className="text-body-sm text-pale-stone">
            You can already use the original.{" "}
            <Link href={itemHref(kind, inReachId)} className="text-warm-off-white underline-offset-2 hover:underline">
              Open it
            </Link>{" "}
            — importing makes a separate copy.
          </p>
        )}
        <RedemptionLine kind={kind} target={target} />
      </header>

      {kind === "skill" ? (
        <SkillEditor
          // A new target org is a new review: its own taken name, a clean form.
          key={target.orgId}
          skill={null}
          source={{
            kind: "share",
            draft: payload.draft,
            takenName:
              refused[target.orgId] ?? (target.nameTaken ? payload.draft.name : null),
            submitLabel: "Import as private",
            blockedReason: imported ? `Already imported into ${target.orgName}.` : null,
            actions: (
              <>
                {picker}
                {notNow}
              </>
            ),
            submit: importDraft,
          }}
        />
      ) : (
        <ResolutionReview
          draft={payload.draft}
          footer={(draft) => (
            <>
              {picker}
              {notNow}
              <ImportButton disabled={!mayImport} onImport={() => importDraft(draft)} />
            </>
          )}
          note={
            imported
              ? `Already imported into ${target.orgName}.`
              : !target.isAdmin
                ? `Only an admin of ${target.orgName} can import a resolution — send them this link.`
                : null
          }
        />
      )}
    </div>
  );
}

function RedemptionLine({ kind, target }: { kind: SharePayload["kind"]; target: ShareTarget }) {
  const r = target.redemption;
  if (!r) return null;
  if (r.status === "declined")
    return (
      <p className="text-body-sm text-bone-gray">
        You passed on this for {target.orgName} on {formatDateTime(r.at)} — you can still import it.
      </p>
    );
  if (!r.copyExists)
    return (
      <p className="text-body-sm text-bone-gray">
        You imported this into {target.orgName} on {formatDateTime(r.at)}, and that copy has since
        been deleted — you can import it again.
      </p>
    );
  return (
    <p className="text-body-sm text-pale-stone">
      You imported this into {target.orgName} on {formatDateTime(r.at)}.{" "}
      {r.importedId && (
        <Link href={itemHref(kind, r.importedId)} className="text-warm-off-white underline-offset-2 hover:underline">
          Open your copy
        </Link>
      )}
    </p>
  );
}

function ResolutionReview({
  draft: shared,
  footer,
  note,
}: {
  draft: ArtifactDraft;
  footer: (draft: ArtifactDraft) => React.ReactNode;
  note: string | null;
}) {
  const [draft, setDraft] = useState(shared);
  return (
    <div className="space-y-5">
      <ArtifactForm draft={draft} onChange={setDraft} />
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <p className="min-w-0 text-body-sm text-bone-gray">{note}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-3">{footer(draft)}</div>
      </div>
    </div>
  );
}

function ImportButton({ disabled, onImport }: { disabled: boolean; onImport: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <span className="text-body-sm text-traffic-red">{error}</span>}
      <Button
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onImport();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
            setBusy(false);
          }
        }}
      >
        {busy ? "Importing…" : "Import"}
      </Button>
    </>
  );
}
