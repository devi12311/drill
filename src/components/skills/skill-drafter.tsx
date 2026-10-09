"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { pickActiveAgent } from "@/components/agents/active-agent";
import type { AgentSummary } from "@/components/agents/agents-dialog";
import type { SkillDraft } from "@/lib/skills/types";

/**
 * "Describe it, Holmes writes it." Sends the description — and the form as it
 * stands, when there is one, so a second pass revises rather than restarts — to
 * the user's Holmes agent, and hands the draft back to the editor. Saving stays
 * the author's step. Whether it shows is the editor's call (Ask Holmes).
 */
export function SkillDrafter({
  current,
  onDraft,
  onClose,
}: {
  /** The form's content, or null when it is still empty. */
  current: SkillDraft | null;
  onDraft: (draft: SkillDraft) => void;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: AgentSummary[]) => {
        setAgents(list);
        setAgentId(pickActiveAgent(list));
      })
      .catch(() => setAgents([]));
    // Leaving the page cancels a draft nobody is waiting for.
    return () => pending.current?.abort();
  }, []);

  const canGenerate = !busy && request.trim() !== "" && agentId !== null;

  async function generate() {
    if (!canGenerate) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, agent_id: agentId, current }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      // A proxy timeout or crash has no JSON body; say what happened, not a code.
      if (!res.ok)
        throw new Error(
          body?.error ??
            `Holmes did not answer (HTTP ${res.status}). Try again, or try another agent.`,
        );
      onDraft(body.draft as SkillDraft);
      setRequest("");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Drafting failed");
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }

  const revising = current !== null;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-smoked-onyx px-4 py-4">
      <div className="flex items-center gap-2 text-body-sm text-warm-off-white">
        <Sparkles className="size-4 text-pale-stone" />
        {revising ? "Revise with Holmes" : "Draft with Holmes"}
      </div>
      <Textarea
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        rows={3}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            generate();
          }
        }}
        autoFocus
        aria-label={revising ? "What to change in the skill" : "What the skill should do"}
        placeholder={
          revising
            ? "What to change — e.g. add a step that checks the message-queue depth before restarting the consumer"
            : "What should it investigate, from which inputs? e.g. checkout is slow for one service — start from the service name, check its pods and recent deploys, then its database latency and the traces of the slowest requests"
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[56ch] text-body-sm text-bone-gray">
          {busy
            ? "Holmes is writing it from your toolsets — this can take a minute…"
            : "Holmes writes from this deployment's toolsets and may run a quick lookup to check a tool name. You review each field it changes before saving."}
        </p>
        <div className="flex items-center gap-2">
          {agents && agents.length > 1 && (
            <select
              value={agentId ?? ""}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={busy}
              aria-label="Holmes agent"
              className="h-8 rounded-sm border border-input bg-transparent px-2 font-mono text-[12px] text-pale-stone outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          {busy ? (
            <Button variant="ghost" size="sm" onClick={() => pending.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={generate}
            disabled={!canGenerate}
            title="⌘↵"
          >
            {busy ? "Drafting…" : revising ? "Revise draft" : "Generate draft"}
          </Button>
        </div>
      </div>
      {agents?.length === 0 && (
        <p className="text-body-sm text-bone-gray">
          Add a Holmes agent from the chat sidebar to draft with it.
        </p>
      )}
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
    </div>
  );
}
