"use client";

import { useState } from "react";
import { Eye, X } from "lucide-react";
import { useSession } from "@/components/session/session-provider";

/**
 * Banner shown across the whole app while an admin is impersonating a user
 * (read-only mode). Rendered by the `(app)` shell; returns null in the normal
 * case so it has no layout impact.
 */
export function ImpersonationBanner() {
  const { user } = useSession();
  const [stopping, setStopping] = useState(false);

  if (!user.impersonating) return null;

  async function stop() {
    setStopping(true);
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
    } finally {
      // Full reload so every view re-fetches as the real admin.
      window.location.assign("/admin/users");
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-b border-gold-leaf/40 bg-gold-leaf/10 px-4 py-2 text-body-sm">
      <Eye className="size-4 text-gold-leaf" />
      <span className="text-warm-off-white">
        Viewing as{" "}
        <span className="font-mono text-gold-leaf">{user.username}</span>
        <span className="text-bone-gray"> · read-only</span>
        {user.impersonatorUsername && (
          <span className="text-bone-gray">
            {" "}
            (you are {user.impersonatorUsername})
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={stopping}
        className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white disabled:opacity-50"
      >
        <X className="size-3.5" />
        Stop
      </button>
    </div>
  );
}
