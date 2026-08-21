"use client";

import { useState } from "react";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Register a cluster. Two credentials, two jobs — spelled out in the form,
 * because "why does this need a kubeconfig AND a Holmes endpoint?" is the first
 * question anyone will have: Holmes can only see the cluster its own pod runs
 * in, so the kubeconfig is Drill's (inventory) and the endpoint is the agent's
 * (investigating).
 */
export function ClusterForm() {
  const refreshThenNavigate = useRefreshThenNavigate();
  const [name, setName] = useState("");
  const [kubeconfig, setKubeconfig] = useState("");
  const [holmesUrl, setHolmesUrl] = useState("");
  const [holmesApiKey, setHolmesApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/monitoring/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kubeconfig, holmesUrl, holmesApiKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setName("");
      setKubeconfig("");
      setHolmesUrl("");
      setHolmesApiKey("");
      // Refresh the tree first, then land on the new cluster — see the hook.
      refreshThenNavigate(`/admin/monitoring/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the cluster");
    } finally {
      setBusy(false);
    }
  }

  return (
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
        <Label htmlFor="cluster-holmes-url">Holmes URL (inside this cluster)</Label>
        <Input
          id="cluster-holmes-url"
          value={holmesUrl}
          onChange={(e) => setHolmesUrl(e.target.value)}
          placeholder="http://holmes.ai-sre.svc.k8s-clickflare:8080"
          autoComplete="off"
          required
        />
        <p className="text-body-sm text-bone-gray">
          The agent that does the investigating. It must be deployed{" "}
          <em>in this cluster</em> — Holmes assesses the cluster its own pod runs
          in and cannot be pointed at another one.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cluster-holmes-key">Holmes API key</Label>
        <Input
          id="cluster-holmes-key"
          type="password"
          value={holmesApiKey}
          onChange={(e) => setHolmesApiKey(e.target.value)}
          autoComplete="off"
          required
        />
      </div>

      {error && <p className="text-body-sm text-traffic-red">{error}</p>}

      <Button type="submit" disabled={busy}>
        {busy ? "Validating both credentials…" : "Add cluster"}
      </Button>
    </form>
  );
}
