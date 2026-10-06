"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import { SELECT_CLASS } from "@/lib/monitoring/ui";
import { AgentsDialog, type AgentSummary } from "@/components/agents/agents-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Register a cluster. Two inputs, two jobs — spelled out in the form, because
 * "why does this need a kubeconfig AND an agent?" is the first question anyone
 * will have: Holmes can only see the cluster its own pod runs in, so the
 * kubeconfig is Drill's (inventory) and the agent does the investigating.
 *
 * The agent is one the org already chats through, picked rather than re-typed,
 * so a URL or key changed in one place is changed for both. Agents are created
 * in the same dialog chat uses; the page re-renders with the new list.
 */
export function ClusterForm({ agents }: { agents: AgentSummary[] }) {
  const router = useRouter();
  const refreshThenNavigate = useRefreshThenNavigate();
  const [name, setName] = useState("");
  const [kubeconfig, setKubeconfig] = useState("");
  const [picked, setPicked] = useState("");
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One agent is the obvious choice; with several, the admin must say which
  // one runs IN this cluster — a wrong default would assess the wrong cluster.
  const agentId = agents.some((a) => a.id === picked)
    ? picked
    : agents.length === 1
      ? agents[0].id
      : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/monitoring/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kubeconfig, agentId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setName("");
      setKubeconfig("");
      setPicked("");
      // Refresh the tree first, then land on the new cluster — see the hook.
      refreshThenNavigate(`/admin/monitoring/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the cluster");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cluster-name">Name</Label>
          <Input
            id="cluster-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CF"
            autoComplete="off"
            required
          />
          <p className="text-body-sm text-bone-gray">
            How this cluster appears in the sidebar.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cluster-kubeconfig">Kubeconfig</Label>
          <Textarea
            id="cluster-kubeconfig"
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
            placeholder="apiVersion: v1&#10;kind: Config&#10;…"
            className="h-40 font-mono text-[12px]"
            spellCheck={false}
            required
          />
          <p className="text-body-sm text-bone-gray">
            Used only to discover Deployments and StatefulSets, so read-only
            credentials are enough. It must be self-contained — inline{" "}
            <span className="font-mono text-[12px]">*-data</span> fields with a
            static token or client certificate. Kubeconfigs that shell out to a
            cloud auth plugin cannot work here.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cluster-agent">Holmes agent (inside this cluster)</Label>
          {agents.length > 0 ? (
            <div className="flex gap-2">
              <select
                id="cluster-agent"
                value={agentId}
                onChange={(e) => setPicked(e.target.value)}
                className={SELECT_CLASS}
                required
              >
                {agentId === "" && (
                  <option value="" disabled>
                    Choose the agent deployed in this cluster
                  </option>
                )}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.url}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => setAgentsOpen(true)}
              >
                <Plus className="size-3.5" />
                New agent
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2.5">
              <p className="text-body-sm text-pale-stone">
                No Holmes agent yet. Create one first — chat uses it too.
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAgentsOpen(true)}>
                <Plus className="size-3.5" />
                Create agent
              </Button>
            </div>
          )}
          <p className="text-body-sm text-bone-gray">
            The agent that does the investigating — the same one your org chats
            with. It must be deployed <em>in this cluster</em>: Holmes assesses the
            cluster its own pod runs in and cannot be pointed at another one.
          </p>
        </div>

        {error && <p className="text-body-sm text-traffic-red">{error}</p>}

        <Button type="submit" disabled={busy || !agentId}>
          {busy ? "Validating kubeconfig and agent…" : "Add cluster"}
        </Button>
      </form>
      {/* Outside the <form>: React bubbles the dialog's own submit through the
          portal into this one. */}
      <AgentsDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        agents={agents}
        onChanged={() => {
          setAgentsOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
