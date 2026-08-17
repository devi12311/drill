"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckForm } from "@/components/monitoring/check-form";
import { SeverityBadge } from "@/components/monitoring/severity-badge";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { CATEGORY_LABEL, TECHNOLOGY_LABEL } from "@/lib/monitoring/ui";
import { MONITOR_CATEGORIES } from "@/lib/monitoring/types";
import type { CheckView, WorkloadTechnology } from "@/lib/monitoring/types";

/**
 * The live rubric. Built-in checks are seeded from the code definitions on first
 * read and can be retuned or disabled here without a deploy; custom checks are
 * added alongside them. A check's ID never changes, because concerns reference
 * it by value.
 */
export default function ChecksPage() {
  const { data, loading, error, refetch } = useAdminData<{
    checks: CheckView[];
  }>("/api/admin/monitoring/checks", []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle(check: CheckView) {
    setBusy(check.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/checks/${check.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !check.enabled }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.autoResolved > 0)
        setActionError(
          `${check.id} disabled — ${body.autoResolved} open concern(s) were closed, because a check that no longer runs can never be re-checked.`,
        );
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(check: CheckView) {
    if (!confirm(`Delete ${check.id}? Disabling is usually safer.`)) return;
    setBusy(check.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/checks/${check.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Check catalogue"
        description="The rubric every assessment answers. Holmes supplies evidence and prose; these checks supply the questions and the severities, which is what makes findings comparable from one run to the next."
      >
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="size-3.5" />
          {creating ? "Cancel" : "New check"}
        </Button>
      </AdminPageHeader>

      {actionError && (
        <p className="text-body-sm text-traffic-yellow">{actionError}</p>
      )}

      {creating && (
        <Card className="p-6">
          <CheckForm
            onSaved={() => {
              setCreating(false);
              refetch();
            }}
          />
        </Card>
      )}

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        MONITOR_CATEGORIES.map((category) => {
          const checks = data.checks.filter((c) => c.category === category);
          return (
            <section key={category} className="space-y-3">
              <h2 className="text-body font-medium text-warm-off-white">
                {CATEGORY_LABEL[category]}
                <span className="ml-2 text-body-sm text-bone-gray">
                  {checks.filter((c) => c.enabled).length} of {checks.length}{" "}
                  active
                </span>
              </h2>

              <div className="space-y-1.5">
                {checks.map((check) => (
                  <Card key={check.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={check.baseSeverity} />
                      <span className="font-mono text-[12px] text-muted-cobalt">
                        {check.id}
                      </span>
                      <span className="min-w-0 flex-1 text-body-sm text-pale-stone">
                        {check.title}
                      </span>
                      {check.builtin ? (
                        <Badge variant="outline" className="text-bone-gray">
                          built-in
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-bone-gray">
                          custom
                        </Badge>
                      )}
                      {check.version > 1 && (
                        <span className="text-caption-tracked text-bone-gray">
                          v{check.version}
                        </span>
                      )}
                      {!check.enabled && (
                        <span className="text-caption-tracked uppercase text-bone-gray">
                          disabled
                        </span>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy === check.id}
                        onClick={() =>
                          setEditing(editing === check.id ? null : check.id)
                        }
                      >
                        {editing === check.id ? "Close" : "Edit"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy === check.id}
                        onClick={() => toggle(check)}
                      >
                        {check.enabled ? "Disable" : "Enable"}
                      </Button>
                      {!check.builtin && (
                        <Button
                          variant="outline"
                          className="text-traffic-red"
                          disabled={busy === check.id}
                          onClick={() => remove(check)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>

                    {editing === check.id ? (
                      <div className="mt-4 border-t border-border pt-4">
                        <CheckForm
                          check={check}
                          onSaved={() => {
                            setEditing(null);
                            refetch();
                          }}
                        />
                      </div>
                    ) : (
                      <div className="mt-1.5 space-y-0.5 text-body-sm text-bone-gray">
                        <p>{check.question}</p>
                        {check.reference && <p>Cites: {check.reference}</p>}
                        {(check.requires ||
                          check.appliesTo.length > 0 ||
                          check.appliesToTechnologies.length > 0 ||
                          check.excludesTechnologies.length > 0 ||
                          check.resolveAfterAbsentRuns > 1) && (
                          <p>
                            {check.requires && `Needs ${check.requires}. `}
                            {check.appliesTo.length > 0 &&
                              `Only ${check.appliesTo.join(", ")}. `}
                            {check.appliesToTechnologies.length > 0 &&
                              `Only ${check.appliesToTechnologies
                                .map(
                                  (t) =>
                                    TECHNOLOGY_LABEL[t as WorkloadTechnology] ?? t,
                                )
                                .join(", ")}. `}
                            {check.excludesTechnologies.length > 0 &&
                              `Never ${check.excludesTechnologies
                                .map(
                                  (t) =>
                                    TECHNOLOGY_LABEL[t as WorkloadTechnology] ?? t,
                                )
                                .join(", ")}. `}
                            {check.resolveAfterAbsentRuns > 1 &&
                              `Auto-resolves after ${check.resolveAfterAbsentRuns} clean runs.`}
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
