"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { useAdminData } from "@/lib/admin/use-admin-data";
import {
  formatNumber,
  formatRelative,
  formatTokens,
  formatUsd,
} from "@/lib/admin/format";
import { CHAT_HOME } from "@/lib/routes";

interface UserStats {
  id: string;
  username: string;
  role: "user" | "admin";
  spend: number;
  investigations: number;
  tokens: number;
  activeConversations: number;
  lastActive: string | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>("30d");
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error } = useAdminData<{ users: UserStats[] }>(
    `/api/admin/users?range=${range}`,
    [range],
  );

  async function impersonate(userId: string) {
    setBusy(userId);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Full reload so the whole app re-fetches as the impersonated user.
      window.location.assign(CHAT_HOME);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to impersonate");
      setBusy(null);
    }
  }

  const columns: Column<UserStats>[] = [
    {
      key: "username",
      header: "User",
      render: (u) => (
        <span className="flex items-center gap-2">
          <span className="text-warm-off-white">{u.username}</span>
          {u.role === "admin" && (
            <Badge variant="outline" className="text-gold-leaf">
              admin
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "investigations",
      header: "Runs",
      align: "right",
      render: (u) => formatNumber(u.investigations),
    },
    {
      key: "spend",
      header: "Spend",
      align: "right",
      render: (u) => (
        <span className="font-mono text-warm-off-white">
          {formatUsd(u.spend)}
        </span>
      ),
    },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      render: (u) => formatTokens(u.tokens),
    },
    {
      key: "activeConversations",
      header: "Convos",
      align: "right",
      render: (u) => formatNumber(u.activeConversations),
    },
    {
      key: "lastActive",
      header: "Last active",
      align: "right",
      render: (u) => formatRelative(u.lastActive),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) => (
        <button
          type="button"
          disabled={busy === u.id}
          onClick={(e) => {
            e.stopPropagation();
            impersonate(u.id);
          }}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white disabled:opacity-50"
        >
          <UserCog className="size-3.5" />
          {busy === u.id ? "…" : "Impersonate"}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Users"
        description="Stats reflect the selected range; click a row for detail."
      >
        <RangePicker value={range} onChange={setRange} />
      </AdminPageHeader>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data.users}
          getKey={(u) => u.id}
          onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
          empty="No users yet."
        />
      )}
    </div>
  );
}
