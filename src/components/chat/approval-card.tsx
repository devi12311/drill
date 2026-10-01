"use client";

import { useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  PendingToolApproval,
  ToolApprovalDecision,
} from "@/lib/holmes/types";

/** What will actually run: bash's command, else the rendered call, else params. */
function invocationOf(approval: PendingToolApproval): string {
  const command = approval.params?.command;
  if (typeof command === "string" && command.trim()) return command;
  if (approval.description?.trim()) return approval.description;
  return JSON.stringify(approval.params ?? {}, null, 2);
}

function ApprovalItem({
  approval,
  decision,
  onDecide,
}: {
  approval: PendingToolApproval;
  decision?: ToolApprovalDecision;
  onDecide: (decision: ToolApprovalDecision) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const deny = () =>
    onDecide({
      tool_call_id: approval.tool_call_id,
      approved: false,
      ...(feedback.trim() && { feedback: feedback.trim() }),
    });
  const params = Object.entries(approval.params ?? {}).filter(
    ([key]) => key !== "command" && key !== "suggested_prefixes",
  );

  return (
    <div className="space-y-3">
      <div className="font-mono text-body-sm text-warm-off-white">
        {approval.tool_name}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-smoked-onyx px-3 py-2 font-mono text-[12px] whitespace-pre-wrap break-all text-pale-stone">
        {invocationOf(approval)}
      </pre>
      {params.length > 0 && approval.params?.command === undefined && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
          {params.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-bone-gray">{key}</dt>
              <dd className="break-all text-pale-stone">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {decision ? (
        <div className="text-body-sm text-bone-gray">
          {decision.approved ? "Approved" : "Denied"}
          {decision.feedback && ` — ${decision.feedback}`}
        </div>
      ) : (
        <>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && feedback.trim()) {
                e.preventDefault();
                deny();
              }
            }}
            rows={2}
            placeholder="Optional: tell Holmes what to do instead (Enter denies with this note)"
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-body-sm text-warm-off-white outline-none placeholder:text-bone-gray focus:border-ring/60"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                onDecide({ tool_call_id: approval.tool_call_id, approved: true })
              }
            >
              <Check className="size-4" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={deny}
            >
              <X className="size-4" />
              {feedback.trim() ? "Deny with note" : "Deny"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Holmes paused on tool calls that need a human decision. Decisions are
 * collected per call and sent together once every call has one.
 * `actionable` is false once the conversation has moved past this pause.
 */
export function ApprovalCard({
  approvals,
  actionable,
  onDecide,
}: {
  approvals: PendingToolApproval[];
  actionable: boolean;
  onDecide: (decisions: ToolApprovalDecision[]) => void;
}) {
  const [decided, setDecided] = useState<Record<string, ToolApprovalDecision>>(
    {},
  );

  if (!actionable) {
    return (
      <div className="flex items-center gap-2 text-body-sm text-bone-gray">
        <ShieldAlert className="size-4" />
        Approval requested for{" "}
        {approvals.map((a) => a.tool_name).join(", ")}
      </div>
    );
  }

  function decide(decision: ToolApprovalDecision) {
    const next = { ...decided, [decision.tool_call_id]: decision };
    setDecided(next);
    if (approvals.every((a) => next[a.tool_call_id])) {
      onDecide(approvals.map((a) => next[a.tool_call_id]));
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-gold-leaf/50 bg-smoke-charcoal/60 px-4 py-3">
      <div className="flex items-center gap-2 text-caption-tracked uppercase text-gold-leaf">
        <ShieldAlert className="size-4" />
        Holmes is waiting for your approval
      </div>
      {approvals.map((approval) => (
        <ApprovalItem
          key={approval.tool_call_id}
          approval={approval}
          decision={decided[approval.tool_call_id]}
          onDecide={decide}
        />
      ))}
    </div>
  );
}
