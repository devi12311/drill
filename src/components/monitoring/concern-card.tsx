"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/admin/format";
import {
  CONCERN_STATUS_CLASS,
  CONCERN_STATUS_LABEL,
} from "@/lib/monitoring/ui";
import type {
  ConcernStatus,
  MonitorEvidence,
  Severity,
} from "@/lib/monitoring/types";

import { SeverityBadge } from "./severity-badge";

/** Catalogue metadata for one check, supplied by the page that loaded it. */
export interface ConcernCheckInfo {
  title: string;
  reference: string;
}

export interface ConcernView {
  id: string;
  checkId: string;
  targetKind: string;
  targetNamespace: string;
  targetName: string;
  scope: string;
  baseSeverity: Severity;
  effectiveSeverity: Severity;
  severityRationale: string | null;
  status: ConcernStatus;
  title: string;
  rationale: string;
  remediation: string;
  evidence: MonitorEvidence[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  dismissalComment: string | null;
}

const ACTIONS: { action: string; label: string; needsComment: boolean }[] = [
  { action: "resolve", label: "Mark fixed", needsComment: false },
  { action: "mute", label: "Mute 30 days", needsComment: true },
  { action: "accept_risk", label: "Accept risk", needsComment: true },
  { action: "false_positive", label: "False positive", needsComment: true },
];

/**
 * One concern, collapsed to its headline. Evidence renders inside a terminal
 * panel: per DESIGN.md the gold/cobalt accents are syntax-only, so this is the
 * one place in the module where they are allowed.
 */
export function ConcernCard({
  concern,
  check,
  onChanged,
}: {
  concern: ConcernView;
  /** Undefined when the check has since been deleted from the catalogue. */
  check?: ConcernCheckInfo;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissed = concern.status !== "open";

  async function act(action: string, needsComment: boolean) {
    let comment = "";
    if (needsComment) {
      comment = window.prompt("Why? (recorded in the audit log)")?.trim() ?? "";
      if (!comment) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/concerns/${concern.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn("overflow-hidden", dismissed && "opacity-70")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-smoke-charcoal/60">
          <ChevronRight
            className={cn(
              "mt-0.5 size-4 shrink-0 text-bone-gray transition-transform",
              open && "rotate-90",
            )}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge
                severity={concern.effectiveSeverity}
                base={concern.baseSeverity}
              />
              <span className="font-mono text-[12px] text-muted-cobalt">
                {concern.checkId}
              </span>
              {dismissed && (
                <span
                  className={cn(
                    "text-caption-tracked uppercase",
                    CONCERN_STATUS_CLASS[concern.status],
                  )}
                >
                  {CONCERN_STATUS_LABEL[concern.status]}
                </span>
              )}
            </div>
            <p className="text-body-sm text-warm-off-white">{concern.title}</p>
            <p className="text-body-sm text-bone-gray">
              <span className="font-mono text-[12px]">
                {concern.targetKind === "statefulset" ? "sts" : "deploy"}/
                {concern.targetName}
              </span>{" "}
              in {concern.targetNamespace}
              {concern.scope && ` · ${concern.scope}`} · seen{" "}
              {concern.occurrenceCount}×, first {formatRelative(concern.firstSeenAt)}
            </p>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 px-4 pb-4 pl-11">
          <p className="text-body-sm text-pale-stone">{concern.rationale}</p>

          {concern.evidence.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-smoke-charcoal">
              <div className="border-b border-border px-3 py-1.5 text-caption-tracked uppercase text-bone-gray">
                Evidence
              </div>
              <dl className="divide-y divide-border/60">
                {concern.evidence.map((item, i) => (
                  <div
                    key={`${item.label}-${i}`}
                    className="flex flex-wrap gap-x-3 px-3 py-1.5 font-mono text-[12px]"
                  >
                    <dt className="text-muted-cobalt">{item.label}</dt>
                    <dd className="min-w-0 flex-1 break-words text-gold-leaf">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-caption-tracked uppercase text-bone-gray">
              Remediation
            </p>
            <p className="text-body-sm text-pale-stone">{concern.remediation}</p>
          </div>

          {concern.severityRationale && (
            <div className="space-y-1">
              <p className="text-caption-tracked uppercase text-bone-gray">
                Why the severity was adjusted
              </p>
              <p className="text-body-sm text-pale-stone">
                {concern.severityRationale}
              </p>
            </div>
          )}

          {check && (
            <p className="text-body-sm text-bone-gray">
              Rubric: {check.title}
              {check.reference && ` — ${check.reference}`}
            </p>
          )}

          {concern.dismissalComment && (
            <p className="text-body-sm text-bone-gray">
              Note: {concern.dismissalComment}
            </p>
          )}

          {error && <p className="text-body-sm text-traffic-red">{error}</p>}

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {dismissed ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act("reopen", false)}
              >
                Reopen
              </Button>
            ) : (
              ACTIONS.map(({ action, label, needsComment }) => (
                <Button
                  key={action}
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(action, needsComment)}
                >
                  {label}
                </Button>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
