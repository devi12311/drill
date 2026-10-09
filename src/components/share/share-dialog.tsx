"use client";

import { useEffect, useState } from "react";
import { Link2, Share2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { CopyField } from "@/components/ui/copy-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArtifactForm } from "@/components/resolutions/artifact-form";
import { useSession } from "@/components/session/session-provider";
import { sendJson } from "@/lib/http";
import { formatDateTime } from "@/lib/admin/format";
import { sharePath } from "@/lib/routes";
import { scanArtifact, scanSkill, stripArtifactCitations, type ShareFinding } from "@/lib/share/scan";
import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  SHARE_EXPIRY_DAYS,
  type ShareAudience,
  type ShareLinkView,
  type SharePayload,
} from "@/lib/share/types";

/** Values shown per finding before "+N more" — enough to recognise, not a dump. */
const SHOWN_VALUES = 6;

/**
 * Share a skill or resolution by link (docs/DECISIONS.md — "Share links"): pick
 * who it is for and how long it lives, see what would leave the org, get the
 * link once — and manage the item's live links.
 *
 * A skill's link carries the skill as saved; a resolution's carries this
 * dialog's (editable) copy, since trimming what leaves the org is the point.
 */
export function ShareDialog({
  sourceId,
  payload,
  audiences,
  open: controlledOpen,
  onOpenChange,
  onEditSource,
}: {
  sourceId: string;
  payload: SharePayload;
  /**
   * Who a link may go to; the first is the default. Without it: a skill goes to
   * colleagues, or (admins) any org; a resolution — every member's already —
   * only outside.
   */
  audiences?: ShareAudience[];
  /** Opened by its owner (a menu item) instead of by its own Share button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Offered when the scan finds something: leave for the item's editor to take it out. */
  onEditSource?: () => void;
}) {
  const { user } = useSession();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setOwnOpen(next));
  // Bumped when a link is made or revoked, so the list reloads.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const allowed =
    audiences ??
    (payload.kind === "skill"
      ? user.isOrgAdmin
        ? (["org", "any"] as ShareAudience[])
        : (["org"] as ShareAudience[])
      : (["any"] as ShareAudience[]));

  return (
    <>
      {!controlled && (
        <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Share2 className="size-3.5" />
          Share
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" className="gap-4">
          <DialogHeader>
            <DialogTitle>Send a copy of this {payload.kind}</DialogTitle>
            <DialogDescription>
              Whoever opens the link signs in, reviews a copy, can edit it, and imports it into
              their own organization — or not, and come back later. The link carries this version;
              later edits are not included.
            </DialogDescription>
          </DialogHeader>
          {/* Mounted per open: a fresh form, never the last link shown, and a fresh list. */}
          {open && (
            <DialogBody className="space-y-6">
              <NewLink
                sourceId={sourceId}
                payload={payload}
                orgName={user.org.name}
                audiences={allowed}
                onCreated={reload}
                onEditSource={
                  onEditSource &&
                  (() => {
                    setOpen(false);
                    onEditSource();
                  })
                }
              />
              <LiveLinks key={version} sourceId={sourceId} onRevoked={reload} />
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const AUDIENCE_LABEL: Record<ShareAudience, (orgName: string) => string> = {
  org: (orgName) => `Colleagues in ${orgName}`,
  any: () => "Anyone with the link, any organization",
};

function NewLink({
  sourceId,
  payload,
  orgName,
  audiences,
  onCreated,
  onEditSource,
}: {
  sourceId: string;
  payload: SharePayload;
  orgName: string;
  audiences: ShareAudience[];
  onCreated: () => void;
  onEditSource?: () => void;
}) {
  const [audience, setAudience] = useState<ShareAudience>(audiences[0]);
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_SHARE_EXPIRY_DAYS);
  const [draft, setDraft] = useState(() =>
    payload.kind === "resolution" ? stripArtifactCitations(payload.draft) : null,
  );
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findings =
    audience === "any" ? (payload.kind === "skill" ? scanSkill(payload.draft) : scanArtifact(draft!)) : [];

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await sendJson("/api/share-links", {
        kind: payload.kind,
        sourceId,
        audience,
        expiresInDays,
        ...(draft ? { draft } : {}),
      });
      setLink(`${window.location.origin}${sharePath(token)}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  }

  if (link)
    return (
      <section className="space-y-2">
        <p className="text-body-sm text-pale-stone">
          Copy it now — Drill keeps only a fingerprint of the link, so it cannot show it to you
          again. Anyone it reaches{" "}
          {audience === "org" ? `in ${orgName} ` : ""}can import it until it expires or you revoke it.
        </p>
        <CopyField value={link} />
      </section>
    );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {audiences.length > 1 ? (
          <select
            aria-label="Who the link is for"
            value={audience}
            onChange={(e) => setAudience(e.target.value as ShareAudience)}
            className={NATIVE_SELECT_CLASS}
          >
            {audiences.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a](orgName)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-body-sm text-pale-stone">{AUDIENCE_LABEL[audience](orgName)}</span>
        )}
        <select
          aria-label="Link lifetime"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(Number(e.target.value))}
          className={NATIVE_SELECT_CLASS}
        >
          {SHARE_EXPIRY_DAYS.map((d) => (
            <option key={d} value={d}>
              expires in {d} days
            </option>
          ))}
        </select>
      </div>

      {findings.length > 0 && <Findings findings={findings} kind={payload.kind} onEditSource={onEditSource} />}

      {draft && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-body-sm text-pale-stone underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
          >
            {editing ? "Done editing" : "Edit what is shared"}
          </button>
          {editing && <ArtifactForm draft={draft} onChange={setDraft} />}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <p className="min-w-0 flex-1 text-body-sm text-traffic-red">{error}</p>}
        <Button onClick={create} disabled={busy || (draft !== null && !draft.title.trim())} className="gap-2">
          <Link2 className="size-4" />
          {busy ? "Creating…" : "Create link"}
        </Button>
      </div>
    </section>
  );
}

/** What identifies the org, before it leaves — a check, not a gate. */
function Findings({
  findings,
  kind,
  onEditSource,
}: {
  findings: ShareFinding[];
  kind: SharePayload["kind"];
  onEditSource?: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-smoked-onyx px-4 py-3">
      <p className="flex items-center gap-2 text-body-sm text-pale-stone">
        <TriangleAlert className="size-4 shrink-0 text-traffic-yellow" />
        This leaves your organization with:
      </p>
      <ul className="space-y-1.5 pl-6">
        {findings.map((f) => (
          <li key={f.label} className="text-body-sm text-bone-gray">
            <span className="text-pale-stone">{f.label}:</span>{" "}
            <span className="font-mono text-[12px] break-all">
              {f.values.slice(0, SHOWN_VALUES).join(", ")}
            </span>
            {f.values.length > SHOWN_VALUES && ` +${f.values.length - SHOWN_VALUES} more`}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-bone-gray">
        Fine if they mean nothing outside — otherwise edit them out first.
        {onEditSource && (
          <>
            {" "}
            <button
              type="button"
              onClick={onEditSource}
              className="text-pale-stone underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
            >
              Edit the {kind} first
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/** The item's live links, loaded when the dialog opens (remounted to reload). */
function LiveLinks({ sourceId, onRevoked }: { sourceId: string; onRevoked: () => void }) {
  const [links, setLinks] = useState<ShareLinkView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    fetch(`/api/share-links?sourceId=${encodeURIComponent(sourceId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ShareLinkView[]>;
      })
      .then(
        (list) => !stale && setLinks(list),
        (err: Error) => !stale && setError(err.message || "Could not load links"),
      );
    return () => {
      stale = true;
    };
  }, [sourceId]);

  if (error) return <p className="text-body-sm text-traffic-red">{error}</p>;
  if (!links?.length) return null;
  return (
    <section>
      <div className="text-caption-tracked uppercase text-bone-gray">Live links</div>
      <ul className="mt-2 divide-y divide-border">
        {links.map((l) => (
          <ShareLinkRow key={l.id} link={l} onRevoked={onRevoked} />
        ))}
      </ul>
    </section>
  );
}

/** One live link: who it is for, how it was received, Revoke. Also used in Org settings. */
export function ShareLinkRow({
  link,
  showTitle = false,
  onRevoked,
}: {
  link: ShareLinkView;
  showTitle?: boolean;
  onRevoked: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const received =
    link.people && link.people.length
      ? link.people.map((p) => `@${p.username} ${p.status}`).join(", ")
      : `${link.imported} imported, ${link.declined} declined`;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm text-warm-off-white">
          {showTitle && <span className="font-mono">{link.title} · </span>}
          {link.audience === "org" ? "Colleagues" : "Any organization"}
          <span className="text-bone-gray"> · {received}</span>
        </div>
        <div className="text-[12px] text-bone-gray">
          by {link.createdByName ?? "former member"} · expires {formatDateTime(link.expiresAt)}
        </div>
        {error && <div className="text-[12px] text-traffic-red">{error}</div>}
      </div>
      <ConfirmButton
        label="Revoke share link"
        title="Revoke this link?"
        description="It stops working at once. Copies already imported stay with whoever imported them."
        confirmLabel="Revoke"
        destructive
        variant="ghost"
        size="sm"
        onConfirm={() =>
          sendJson(`/api/share-links/${link.id}`, {}, "DELETE").then(onRevoked, (err: Error) =>
            setError(err.message),
          )
        }
      >
        Revoke
      </ConfirmButton>
    </li>
  );
}
