"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/shell/brand-mark";
import { INVITE_PREFIX, LOGIN_PATH } from "@/lib/routes";

const LINK_CLASS =
  "text-pale-stone underline underline-offset-4 hover:text-warm-off-white";

/**
 * Username + password, posted to `/api/auth/{mode}` with any `extra` body
 * fields. Shared by the auth pages and the invitation card, which signs a new
 * invitee up and joins them in one request.
 */
export function CredentialsForm({
  mode,
  extra,
  submitLabel,
  onSuccess,
}: {
  mode: "login" | "register";
  extra?: Record<string, string>;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extra, username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="username" className="text-pale-stone">
          Username
        </Label>
        <Input
          id="username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-pale-stone">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="font-mono"
        />
      </div>
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      <Button
        type="submit"
        className="w-full"
        disabled={busy || !username || !password}
      >
        {busy ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}

/**
 * `next` is where to go afterwards (already checked with `safeNext` by the page):
 * an invite link opened while signed out comes back to the invite. An invitee
 * without an account is sent back to the invite to register — signing up there
 * joins the org, where /register would make them an org of their own.
 */
export function AuthForm({
  mode,
  next,
}: {
  mode: "login" | "register";
  next: string | null;
}) {
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";
  const registerHref = next?.startsWith(INVITE_PREFIX) ? next : `/register${carry}`;
  const router = useRouter();

  return (
    <main className="flex h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-[380px]">
        <BrandMark className="mb-8" />
        <div className="space-y-5 rounded-lg border border-border bg-smoked-onyx p-6">
          <h1 className="text-heading-sm text-warm-off-white">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <CredentialsForm
            mode={mode}
            submitLabel={mode === "login" ? "Sign in" : "Create account"}
            onSuccess={() => {
              router.push(next ?? "/");
              router.refresh();
            }}
          />
          <p className="text-body-sm text-bone-gray">
            {mode === "login" ? (
              <>
                No account?{" "}
                <Link href={registerHref} className={LINK_CLASS}>
                  Register
                </Link>
              </>
            ) : (
              <>
                Already registered?{" "}
                <Link href={`${LOGIN_PATH}${carry}`} className={LINK_CLASS}>
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </main>
  );
}
