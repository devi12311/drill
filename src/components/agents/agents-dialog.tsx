"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AgentSummary {
  id: string;
  name: string;
  url: string;
  lastValidatedAt: string | null;
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
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setName("");
      setUrl("");
      setApiKey("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
    } finally {
      setBusy(false);
    }
  }

  async function removeAgent(id: string) {
    await fetch(`/api/agents/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Holmes agents</DialogTitle>
          <DialogDescription>
            Each agent is a HolmesGPT endpoint. The API key is verified against
            the agent before saving. Deleting an agent deletes its
            conversations.
          </DialogDescription>
        </DialogHeader>

        {agents.length > 0 && (
          <div className="space-y-1">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="group flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-smoke-charcoal"
              >
                <span
                  className={
                    "size-1.5 shrink-0 rounded-full " +
                    (agent.lastValidatedAt
                      ? "bg-traffic-green"
                      : "bg-traffic-yellow")
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body-sm text-warm-off-white">
                    {agent.name}
                  </div>
                  <div className="truncate font-mono text-[11px] text-bone-gray">
                    {agent.url}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${agent.name}`}
                  onClick={() => removeAgent(agent.id)}
                  className="hidden shrink-0 rounded-sm p-1 text-bone-gray hover:text-traffic-red group-hover:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addAgent} className="space-y-4 border-t border-border pt-4">
          <div className="text-caption-tracked uppercase text-bone-gray">
            Add agent
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-name" className="text-pale-stone">
              Name
            </Label>
            <Input
              id="agent-name"
              placeholder="prod-cluster"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-url" className="text-pale-stone">
              URL
            </Label>
            <Input
              id="agent-url"
              placeholder="http://localhost:43289"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-key" className="text-pale-stone">
              API key
            </Label>
            <Input
              id="agent-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
            />
          </div>
          {error && <p className="text-body-sm text-traffic-red">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !name.trim() || !url.trim() || !apiKey.trim()}
          >
            {busy ? "Validating…" : "Validate & add"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
