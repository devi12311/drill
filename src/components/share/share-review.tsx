"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { ArtifactForm } from "@/components/resolutions/artifact-form";
import { StickyBar } from "@/components/ui/sticky-bar";
import { SkillEditor } from "@/components/skills/skill-editor";
import { SkillReader } from "@/components/skills/skill-reader";
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
 * The recipient's side of a share link. A skill is shown to be read — the
 * warning says to read the whole procedure — with the decision pinned above
 * it: Import a private copy into the chosen org, Edit before importing (the
 * usual editor), or Skip, which keeps the link usable for later. A resolution
 * is reviewed in its editable form under the same bar.
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
  const [editing, setEditing] = useState(false);
  const target = targets.find((t) => t.orgId === orgId) ?? targets[0];
  const { kind } = payload;
  // Only a copy that still exists blocks importing again.
  const imported =
    target.redemption?.status === "imported" && target.redemption.copyExists
      ? target.redemption
      : null;
  const mayImport = !imported && (kind === "skill" || target.isAdmin);
  const takenName =
    kind === "skill"
      ? (refused[target.orgId] ?? (target.nameTaken ? payload.draft.name : null))
      : null;

  async function importDraft(draft: SkillDraft | ArtifactDraft) {
    const { ok, status, data } = await post(`/api/share/${encodeURIComponent(token)}/import`, {
      orgId: target.orgId,
      draft,
    });
    if (status === 409 && data.field === "name") {
      // Someone took the name meanwhile: the editor marks it on the Name field.
      setRefused((r) => ({ ...r, [target.orgId]: (draft as SkillDraft).name }));
      setEditing(true);
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

  // Recorded for the sharer's counts, never final: the link still imports later (decision 143).
  const skip = (
    <Button variant="ghost" size="sm" onClick={decline} title="You can still import it later from this link">
      Skip
    </Button>
  );

  if (kind === "skill" && editing)
    return (
      <SkillEditor
        // A new target org is a new review: its own taken name, a clean form.
        key={target.orgId}
        skill={null}
        source={{
          kind: "share",
          draft: payload.draft,
          takenName,
          submitLabel: "Import as private",
          blockedReason: imported ? `Already imported into ${target.orgName}.` : null,
          actions: picker,
          submit: importDraft,
        }}
        onCancel={() => setEditing(false)}
      />
    );

  return (
    <div className="space-y-8">
      {kind === "skill" && (
        <StickyBar>
          <p aria-live="polite" className="min-w-48 flex-1 text-body-sm">
            {imported ? (
              <span className="text-bone-gray">Already imported into {target.orgName}.</span>
            ) : takenName ? (
              <span className="text-pale-stone">
                {target.orgName} already has a skill named{" "}
                <span className="font-mono">{takenName}</span> — rename this copy before importing.
              </span>
            ) : (
              <span className="text-bone-gray">Read it through, then import a private copy.</span>
            )}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {picker}
            {imported ? (
              // Nothing left to decide for this org; another org in the picker may still import.
              imported.importedId && (
                <Button asChild size="sm">
                  <Link href={itemHref(kind, imported.importedId)}>Open your copy</Link>
                </Button>
              )
            ) : (
              <>
                {skip}
                <Button
                  variant={takenName ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Edit before importing
                </Button>
                {!takenName && (
                  <ImportButton
                    label="Import as private"
                    disabled={false}
                    onImport={() => importDraft(payload.draft)}
                  />
                )}
              </>
            )}
          </div>
        </StickyBar>
      )}
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
        <SkillReader draft={payload.draft} />
      ) : (
        <ResolutionReview
          draft={payload.draft}
          footer={(draft) => (
            <>
              {picker}
              {skip}
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
      <StickyBar>
        <p className="min-w-48 flex-1 text-body-sm text-bone-gray">
          {note ?? "Edit what you need, then import it into your organization."}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">{footer(draft)}</div>
      </StickyBar>
      <ArtifactForm draft={draft} onChange={setDraft} />
    </div>
  );
}

function ImportButton({
  label = "Import",
  disabled,
  onImport,
}: {
  label?: string;
  disabled: boolean;
  onImport: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <span className="text-body-sm text-traffic-red">{error}</span>}
      <Button
        size="sm"
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
        {busy ? "Importing…" : label}
      </Button>
    </>
  );
}
