"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { useSession } from "@/components/session/session-provider";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/admin/format";

interface AuditRow {
  id: string;
  orgName: string | null;
  action: string;
  actorUsername: string | null;
  targetUsername: string | null;
  metadata: unknown;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  "impersonate.start": "Started impersonating",
  "impersonate.stop": "Stopped impersonating",
  "skill.update": "Changed a shared skill",
  "skill.delete": "Deleted a shared skill",
  "org.created": "Created the organization",
  "org.renamed": "Renamed the organization",
  "org.invite.created": "Created an invite",
  "org.invite.revoked": "Revoked an invite",
  "org.invite.accepted": "Joined by invite",
  "org.member.role": "Changed a member's role",
  "org.member.removed": "Removed a member",
  "org.member.left": "Left the organization",
};

export default function AdminAuditPage() {
  const { user } = useSession();
  const [range, setRange] = useState<Range>("30d");
  // Platform admins can widen the trail to every org; org admins see their own.
  const [all, setAll] = useState(false);
  const { data, loading, error } = useAdminData<{ entries: AuditRow[] }>(
    `/api/admin/audit?range=${range}${all ? "&scope=all" : ""}`,
    [range, all],
  );

  const columns: Column<AuditRow>[] = [
    ...(all
      ? [{ key: "org", header: "Org", render: (r: AuditRow) => r.orgName ?? "platform" }]
      : []),
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <Badge variant="outline" className="text-muted-cobalt">
          {ACTION_LABEL[r.action] ?? r.action}
        </Badge>
      ),
    },
    {
      key: "actor",
      header: "By",
      render: (r) => r.actorUsername ?? "—",
    },
    {
      key: "target",
      header: "Target user",
      render: (r) => (
        <span className="text-warm-off-white">{r.targetUsername ?? "—"}</span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      align: "right",
      render: (r) => formatDateTime(r.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit log"
        description={
          all
            ? "Every organization's trail, plus platform actions such as impersonation."
            : `Who changed what in ${user.org.name}: members and invites, shared skills, the monitoring catalogue, clusters, jobs and concerns.`
        }
      >
        {user.actorIsAdmin && (
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {[false, true].map((scope) => (
              <button
                key={String(scope)}
                type="button"
                aria-pressed={all === scope}
                onClick={() => setAll(scope)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-body-sm transition-colors",
                  all === scope
                    ? "bg-smoke-charcoal text-warm-off-white"
                    : "text-bone-gray hover:text-warm-off-white",
                )}
              >
                {scope ? "All organizations" : "This organization"}
              </button>
            ))}
          </div>
        )}
        <RangePicker value={range} onChange={setRange} />
      </AdminPageHeader>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data.entries}
          getKey={(r) => r.id}
          empty="No admin actions recorded in this range."
        />
      )}
    </div>
  );
}
