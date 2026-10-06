"use client";

import { useState } from "react";
import Link from "next/link";
import { CredentialsForm } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { invitePath, loginUrl } from "@/lib/routes";
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

/**
 * For a signed-out invitee: create the account and join in one request — the
 * invitee chooses their own username, the link only carries the org and role.
 * Someone who already has an account signs in and comes back here to join.
 */
export function SignUpAndJoin({ token }: { token: string }) {
  return (
    <>
      <CredentialsForm
        mode="register"
        extra={{ invite: token }}
        submitLabel="Create account & join"
        onSuccess={() => reloadInto("/")}
      />
      <p className="text-body-sm text-bone-gray">
        Already have a Drill account?{" "}
        <Link
          href={loginUrl(invitePath(token))}
          className="text-pale-stone underline underline-offset-4 hover:text-warm-off-white"
        >
          Sign in to join
        </Link>
      </p>
    </>
  );
}
