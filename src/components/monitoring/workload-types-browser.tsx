"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DialogBody } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CatalogueScopeSwitch } from "@/components/monitoring/catalogue-scope-switch";
import {
  DefinitionGrid,
  DefinitionTile,
} from "@/components/monitoring/definition-grid";
import {
  DefinitionBlock,
  DefinitionModal,
  ModalFooter,
  useDefinitionParam,
} from "@/components/monitoring/definition-modal";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import {
  SOURCE_LABEL,
  scopedUrl,
  type CatalogueScope,
} from "@/lib/monitoring/catalogue-scope";
import {
  WORKLOAD_TYPE_LIMITS,
  type WorkloadTypeView,
} from "@/lib/monitoring/workload-types";

const API = "/api/admin/monitoring/types";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * Workload types as data (docs/DECISIONS.md 128): what a workload can be, and the
 * rules discovery recognises it by. A rule change applies at the next discovery,
 * so the page carries a rescan for every cluster of the org.
 */
export function WorkloadTypesBrowser({
  types,
  scope,
  canEditTemplates,
  clusterIds,
}: {
  types: WorkloadTypeView[];
  scope: CatalogueScope;
  canEditTemplates: boolean;
  clusterIds: string[];
}) {
  const refresh = useRefreshThenNavigate();
  const [openSlug, setOpenSlug] = useDefinitionParam("type");
  const [rescan, setRescan] = useState<"idle" | "busy" | "done" | string>("idle");
  const creating = openSlug === "new";
  const open = creating ? null : (types.find((t) => t.slug === openSlug) ?? null);

  async function rescanAll() {
    setRescan("busy");
    try {
      // One cluster at a time: each discovery lists every workload in a cluster.
      for (const id of clusterIds)
        await send(`/api/admin/monitoring/clusters/${id}/discover`, "POST");
      setRescan("done");
      refresh(null);
    } catch (err) {
      setRescan(err instanceof Error ? err.message : "Rescan failed");
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={scope === "templates" ? "Workload type templates" : "Workload types"}
        description={
          scope === "templates"
            ? "The shared types every organization inherits, and how discovery recognises each. An edit reaches every org that has not customized that type."
            : "What a workload can be, and how discovery recognises it. Add a type for an engine Drill does not ship, or customize a shared one to match your naming. Checks and playbooks scope themselves to these types."
        }
      >
        {canEditTemplates && (
          <CatalogueScopeSwitch path="/admin/monitoring/types" scope={scope} />
        )}
        <Button onClick={() => setOpenSlug("new")}>
          <Plus className="size-3.5" />
          New type
        </Button>
      </AdminPageHeader>

      {clusterIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-smoked-onyx/40 px-4 py-3">
          <p className="min-w-0 flex-1 text-body-sm text-bone-gray">
            Rules apply when a cluster is next discovered. Rescan to re-label every
            workload now — technologies set by hand are never changed.
          </p>
          <Button variant="outline" disabled={rescan === "busy"} onClick={rescanAll} className="gap-2">
            <RefreshCw className="size-3.5" />
            {rescan === "busy" ? "Rescanning…" : `Rescan ${clusterIds.length === 1 ? "cluster" : `${clusterIds.length} clusters`}`}
          </Button>
          {rescan === "done" && <span className="text-body-sm text-traffic-green">Rescanned.</span>}
          {rescan !== "idle" && rescan !== "busy" && rescan !== "done" && (
            <span className="text-body-sm text-traffic-red">{rescan}</span>
          )}
        </div>
      )}

      <DefinitionGrid>
        {types.map((t) => (
          <DefinitionTile
            key={t.slug}
            id={t.slug}
            title={t.label}
            caption={t.slug}
            meta={`priority ${t.priority} · ${t.patterns.length} pattern${t.patterns.length === 1 ? "" : "s"}`}
            marker={
              !t.enabled
                ? "disabled"
                : t.updateAvailable
                  ? "update"
                  : t.source !== "template"
                    ? SOURCE_LABEL[t.source]
                    : undefined
            }
            dimmed={!t.enabled}
            onOpen={setOpenSlug}
          />
        ))}
      </DefinitionGrid>

      <TypePanel
        key={openSlug ?? "closed"}
        summary={open}
        creating={creating}
        scope={scope}
        onOpenSlug={setOpenSlug}
        onMutated={() => refresh(null)}
      />
    </div>
  );
}

function TypePanel({
  summary,
  creating,
  scope,
  onOpenSlug,
  onMutated,
}: {
  summary: WorkloadTypeView | null;
  creating: boolean;
  scope: CatalogueScope;
  onOpenSlug: (slug: string | null) => void;
  onMutated: () => void;
}) {
  const detail = useAdminData<{ type: WorkloadTypeView; template: WorkloadTypeView | null }>(
    summary ? scopedUrl(`${API}/${summary.slug}`, scope) : "",
    [summary?.slug, scope],
  );
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forks = scope === "org" && summary?.source === "template";

  function close() {
    onOpenSlug(null);
  }
  function mayDiscard() {
    return !dirty || confirm("Discard your unsaved changes to this workload type?");
  }

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      close();
      onMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setBusy(false);
    }
  }

  const t = detail.data?.type ?? summary;
  const template = detail.data?.template;

  return (
    <DefinitionModal
      open={creating || summary !== null}
      onClose={close}
      confirmClose={mayDiscard}
      title={creating ? "New workload type" : (summary?.label ?? "")}
      identifier={creating ? undefined : summary?.slug}
      badges={
        summary && (
          <>
            {scope === "org" && (
              <Badge variant="outline" className="text-bone-gray">
                {SOURCE_LABEL[summary.source]}
              </Badge>
            )}
            {summary.updateAvailable && (
              <span className="text-caption-tracked uppercase text-traffic-yellow">
                template updated
              </span>
            )}
            {!summary.enabled && (
              <span className="text-caption-tracked uppercase text-bone-gray">disabled</span>
            )}
          </>
        )
      }
    >
      {creating || editing ? (
        <TypeForm
          type={creating ? null : t}
          scope={scope}
          onDirtyChange={setDirty}
          onCancel={() => {
            if (!mayDiscard()) return;
            setDirty(false);
            if (creating) close();
            else setEditing(false);
          }}
          onSaved={() => {
            setDirty(false);
            close();
            onMutated();
          }}
        />
      ) : !t || detail.loading ? (
        <DialogBody className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-10" />
        </DialogBody>
      ) : (
        <>
          <DialogBody className="space-y-4">
            {error && <p className="text-body-sm text-traffic-red">{error}</p>}
            {template && summary?.updateAvailable && (
              <DefinitionBlock label="The shared template changed">
                <RuleList label="Label" values={[template.label]} />
                <RuleList label="Priority" values={[String(template.priority)]} />
                <RuleList label="App-name labels" values={template.labelValues} />
                <RuleList label="Patterns" values={template.patterns} />
              </DefinitionBlock>
            )}
            <DefinitionBlock label="Recognised by">
              <RuleList label="App-name labels" values={t.labelValues} />
              <RuleList label="Image and container patterns" values={t.patterns} />
            </DefinitionBlock>
            <DefinitionBlock label="Priority">
              <p className="text-body-sm text-bone-gray">
                {t.priority} — when several types match one workload, the higher
                priority wins.
              </p>
            </DefinitionBlock>
          </DialogBody>
          <ModalFooter>
            <Button
              disabled={busy}
              onClick={() => setEditing(true)}
              title={forks ? "Gives your organization its own copy; the shared type is unchanged" : undefined}
            >
              {forks ? "Customize" : "Edit"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                act(() => send(scopedUrl(`${API}/${t.slug}`, scope), "PATCH", { enabled: !t.enabled }))
              }
            >
              {t.enabled ? "Disable" : "Enable"}
            </Button>
            {summary?.updateAvailable && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act(() => send(`${API}/${t.slug}/reviewed`, "POST"))}
              >
                Keep my version
              </Button>
            )}
            {scope === "org" && summary?.source === "override" && (
              <ConfirmButton
                label="Reset to template"
                title={`Reset ${t.label} to the shared type?`}
                description="Your organization's rules are discarded and discovery uses the shared ones from the next rescan."
                confirmLabel="Reset"
                disabled={busy}
                onConfirm={() => act(() => send(scopedUrl(`${API}/${t.slug}`, scope), "DELETE"))}
              />
            )}
            {(scope === "templates" ? !t.builtin : summary?.source === "custom") && (
              <ConfirmButton
                label="Delete"
                title={`Delete ${t.label}?`}
                description="Workloads labelled with it keep that label until the next rescan, and checks scoped to it stop matching anything. Disabling is the reversible alternative."
                confirmLabel="Delete type"
                destructive
                disabled={busy}
                onConfirm={() => act(() => send(scopedUrl(`${API}/${t.slug}`, scope), "DELETE"))}
              />
            )}
            <Button variant="ghost" className="ml-auto" disabled={busy} onClick={close}>
              Close
            </Button>
          </ModalFooter>
        </>
      )}
    </DefinitionModal>
  );
}

function RuleList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-caption-tracked uppercase text-bone-gray">{label}</span>
      {values.length === 0 ? (
        <span className="text-body-sm text-bone-gray">none</span>
      ) : (
        values.map((v) => (
          <code key={v} className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 font-mono text-[12px] text-pale-stone">
            {v}
          </code>
        ))
      )}
    </div>
  );
}

/** One entry per line or comma — how people paste lists. */
const splitList = (text: string) =>
  text.split(/[\n,]/).map((v) => v.trim().toLowerCase()).filter(Boolean);

interface Preview {
  gained: { cluster: string; workload: string; was: string | null; reason: string }[];
  gainedTotal: number;
  lost: { cluster: string; workload: string; becomes: string | null }[];
  lostTotal: number;
  note: string;
}

function TypeForm({
  type,
  scope,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  type: WorkloadTypeView | null;
  scope: CatalogueScope;
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [slug, setSlug] = useState(type?.slug ?? "");
  const [label, setLabel] = useState(type?.label ?? "");
  const [priority, setPriority] = useState(String(type?.priority ?? 0));
  const [labelValues, setLabelValues] = useState((type?.labelValues ?? []).join("\n"));
  const [patterns, setPatterns] = useState((type?.patterns ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const draft = {
    slug: slug.trim().toLowerCase(),
    label,
    priority: Number(priority),
    labelValues: splitList(labelValues),
    patterns: splitList(patterns),
    enabled: type?.enabled ?? true,
  };
  const draftKey = JSON.stringify(draft);
  const initialKey = useRef(draftKey);

  useEffect(() => {
    onDirtyChange(draftKey !== initialKey.current);
  }, [draftKey, onDirtyChange]);

  // A debounced dry run against the org's discovered workloads, so a pattern's
  // reach is visible before it is saved rather than after the next rescan.
  useEffect(() => {
    const body = JSON.parse(draftKey) as typeof draft;
    if (!body.slug || body.patterns.length === 0) return;
    const timer = setTimeout(() => {
      send(`${API}/preview`, "POST", body)
        .then((p: Preview) => setPreview(p))
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [draftKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (type) await send(scopedUrl(`${API}/${type.slug}`, scope), "PATCH", draft);
      else await send(scopedUrl(API, scope), "POST", draft);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogBody className="space-y-4">
        {!type && (
          <div className="space-y-1.5">
            <Label htmlFor="type-slug" className="text-pale-stone">Slug</Label>
            <Input
              id="type-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="redis"
              className="font-mono"
              autoFocus
            />
            <p className="text-body-sm text-bone-gray">
              Lowercase, permanent — workloads, check scopes and the playbook all store it.
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div className="space-y-1.5">
            <Label htmlFor="type-label" className="text-pale-stone">Name</Label>
            <Input
              id="type-label"
              value={label}
              maxLength={WORKLOAD_TYPE_LIMITS.label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Redis"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type-priority" className="text-pale-stone">Priority</Label>
            <Input
              id="type-priority"
              type="number"
              min={WORKLOAD_TYPE_LIMITS.priority.min}
              max={WORKLOAD_TYPE_LIMITS.priority.max}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type-patterns" className="text-pale-stone">Image and container patterns</Label>
          <Textarea
            id="type-patterns"
            rows={3}
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            placeholder={"redis\nbitnami-redis"}
            className="font-mono text-[13px]"
          />
          <p className="max-w-[80ch] text-body-sm text-bone-gray">
            One per line. Whole words of the image path, in order: <code className="font-mono">redis</code>{" "}
            matches <code className="font-mono">docker.io/bitnami/redis:7</code> but not{" "}
            <code className="font-mono">redisinsight</code>. Exporters, operators and similar
            helpers are never matched.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type-labels" className="text-pale-stone">App-name labels</Label>
          <Textarea
            id="type-labels"
            rows={2}
            value={labelValues}
            onChange={(e) => setLabelValues(e.target.value)}
            placeholder="redis"
            className="font-mono text-[13px]"
          />
          <p className="text-body-sm text-bone-gray">
            Exact values of <code className="font-mono">app.kubernetes.io/name</code>,{" "}
            <code className="font-mono">app</code> or <code className="font-mono">application</code>.
          </p>
        </div>

        {preview && (
          <DefinitionBlock label="If you save this">
            <p className="text-body-sm text-pale-stone">
              {preview.gainedTotal} workload{preview.gainedTotal === 1 ? "" : "s"} would become this
              type{preview.lostTotal > 0 && `, ${preview.lostTotal} would stop being it`}.
            </p>
            <ul className="space-y-1">
              {preview.gained.map((g) => (
                <li key={`${g.cluster}/${g.workload}`} className="text-body-sm text-bone-gray">
                  <span className="font-mono text-pale-stone">{g.workload}</span> · {g.cluster} ·{" "}
                  {g.reason}
                  {g.was && <> (now {g.was})</>}
                </li>
              ))}
              {preview.lost.map((l) => (
                <li key={`${l.cluster}/${l.workload}`} className="text-body-sm text-traffic-yellow">
                  <span className="font-mono">{l.workload}</span> · {l.cluster} · would become{" "}
                  {l.becomes ?? "unidentified"}
                </li>
              ))}
            </ul>
            <p className="text-caption-tracked text-bone-gray">{preview.note}</p>
          </DefinitionBlock>
        )}
        {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      </DialogBody>
      <ModalFooter>
        <Button type="submit" disabled={busy || !label.trim() || (!type && !slug.trim())}>
          {busy ? "Saving…" : type ? "Save" : "Create type"}
        </Button>
        <Button type="button" variant="ghost" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </form>
  );
}
