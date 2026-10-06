"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { reloadInto, sendJson } from "./org-actions";

export function AcceptInvite({ token, orgName }: { token: string; orgName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await sendJson(`/api/invites/${encodeURIComponent(token)}`, {});
            reloadInto("/");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : `Join ${orgName}`}
      </Button>
    </div>
  );
}
