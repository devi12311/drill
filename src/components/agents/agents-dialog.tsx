"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRelative } from "@/lib/admin/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/session/session-provider";
import { agentHealth, HEALTH_DOT, type Health } from "@/lib/health";
import { pickActiveAgent } from "./active-agent";

export interface AgentSummary {
  id: string;
  name: string;
  url: string;
  /** Who registered it — shown, not a permission: only org admins manage agents. */
  createdBy: string | null;
  /** Last successful contact, and why the latest one failed (lib/health.ts). */
  lastValidatedAt: string | null;
  lastError: string | null;
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm bg-iron-veil px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.1em] text-pale-stone">
      {children}
    </span>
  );
}

const STATUS_LABEL: Record<Health, (agent: AgentSummary) => string> = {
  ok: (a) => `reached ${formatRelative(a.lastValidatedAt)}`,
  down: () => "unreachable",
  stale: (a) => (a.lastValidatedAt ? `last reached ${formatRelative(a.lastValidatedAt)}` : "not checked yet"),
};

function AgentStatus({ agent }: { agent: AgentSummary }) {
  const h = agentHealth(agent);
  return (
    <span
      className={cn("shrink-0", h === "down" && "text-traffic-red")}
      title={h === "down" ? (agent.lastError ?? undefined) : undefined}
    >
      {STATUS_LABEL[h](agent)}
    </span>
  );
}

function DeleteAgent({ agent, onDelete }: { agent: AgentSummary; onDelete: () => void }) {
  return (
    <ConfirmButton
      label={`Delete ${agent.name}`}
      title={`Delete ${agent.name}?`}
      description="Every conversation that ran on this agent is deleted with it, for everyone in the org. This cannot be undone."
      confirmLabel="Delete agent"
      destructive
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-bone-gray opacity-0 hover:text-traffic-red focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
      onConfirm={onDelete}
    >
      <Trash2 className="size-3.5" />
    </ConfirmButton>
  );
}

interface FormState {
  name: string;
  url: string;
  apiKey: string;
  setName: (v: string) => void;
  setUrl: (v: string) => void;
  setApiKey: (v: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  /** Absent when there are no agents yet: the form is then the whole dialog. */
  onCancel?: () => void;
}

function AddAgentForm({ f }: { f: FormState }) {
  const ready = f.name.trim() && f.url.trim() && f.apiKey.trim();
  return (
    <form onSubmit={f.onSubmit} className="space-y-3">
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name" className="text-pale-stone">
            Name
          </Label>
          <Input
            id="agent-name"
            placeholder="prod-cluster"
            value={f.name}
            onChange={(e) => f.setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-url" className="text-pale-stone">
            URL
          </Label>
          <Input
            id="agent-url"
            placeholder="http://localhost:43289"
            value={f.url}
            onChange={(e) => f.setUrl(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="agent-key" className="text-pale-stone">
          API key
        </Label>
        <Input
          id="agent-key"
          type="password"
          autoComplete="off"
          value={f.apiKey}
          onChange={(e) => f.setApiKey(e.target.value)}
          className="font-mono"
        />
      </div>
      {f.error && <p className="text-body-sm text-traffic-red">{f.error}</p>}
      <div className="flex items-center justify-end gap-2 pt-1">
        {f.onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={f.onCancel} disabled={f.busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={f.busy || !ready}>
          {f.busy ? "Validating…" : "Validate & add"}
        </Button>
      </div>
    </form>
  );
}

export function AgentsDialog({
  open,
  onOpenChange,
  agents,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentSummary[];
  onChanged: () => void;
}) {
  const { user } = useSession();
  // Members chat through the org's agents but cannot change them (the API agrees).
  const canManage = user.isOrgAdmin;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // With no agents the form is the only thing worth showing.
  const showForm = canManage && (adding || agents.length === 0);
  // Read only while open: the dialog's content renders client-side, after hydration.
  const activeId = open ? pickActiveAgent(agents) : null;

  function resetForm() {
    setName("");
    setUrl("");
    setApiKey("");
    setError(null);
  }

  async function addAgent(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, apiKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      resetForm();
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
    } finally {
      setBusy(false);
    }
  }

  async function removeAgent(id: string) {
    setRemoveError(null);
    try {
      const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
      // A cluster still monitored through it is the usual reason; the API names it.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRemoveError(body.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setRemoveError("Could not delete the agent");
    }
    onChanged();
  }

  const form: FormState = {
    name,
    url,
    apiKey,
    setName,
    setUrl,
    setApiKey,
    error,
    busy,
    onSubmit: addAgent,
    onCancel:
      agents.length > 0
        ? () => {
            resetForm();
            setAdding(false);
          }
        : undefined,
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetForm();
          setAdding(false);
          setRemoveError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[480px] gap-4">
        <DialogHeader>
          <DialogTitle>Holmes agents</DialogTitle>
          <DialogDescription>
            HolmesGPT endpoints everyone in {user.org.name} investigates with, in chat
            and in monitoring.{" "}
            {canManage
              ? "Keys are verified before saving."
              : "Only owners and admins can add or change them."}
          </DialogDescription>
        </DialogHeader>
        {agents.length > 0 && (
          <ul className="-mx-2 space-y-0.5">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-smoke-charcoal/60"
              >
                <span className="relative grid size-9 shrink-0 place-items-center rounded-md bg-iron-veil font-mono text-[13px] uppercase text-warm-off-white">
                  {agent.name.slice(0, 2)}
                  <span
                    className={cn(
                      "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-popover",
                      HEALTH_DOT[agentHealth(agent)],
                    )}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-body-sm font-medium text-warm-off-white">
                      {agent.name}
                    </span>
                    {agent.id === activeId && <Tag>Active</Tag>}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-bone-gray">
                    <span className="truncate">{agent.url}</span>
                    <span aria-hidden>·</span>
                    <AgentStatus agent={agent} />
                  </div>
                </div>
                {canManage && (
                  <DeleteAgent agent={agent} onDelete={() => removeAgent(agent.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
        {removeError && <p className="text-body-sm text-traffic-red">{removeError}</p>}
        {!canManage && agents.length === 0 && (
          <p className="text-body-sm text-pale-stone">
            No agents yet. Ask an owner or admin of {user.org.name} to add one.
          </p>
        )}
        {showForm ? (
          <div className={cn("space-y-3", agents.length > 0 && "border-t border-border pt-4")}>
            <div className="text-caption-tracked uppercase text-bone-gray">New agent</div>
            <AddAgentForm f={form} />
          </div>
        ) : canManage && (
          <Button variant="secondary" onClick={() => setAdding(true)} className="w-full justify-center">
            <Plus className="size-3.5" />
            Add agent
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
