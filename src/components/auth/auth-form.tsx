"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
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
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="flex h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-8">
          <div className="font-mono text-body font-medium tracking-[0.2em] text-warm-off-white">
            DRILL
          </div>
          <div className="text-caption-tracked mt-1 uppercase text-bone-gray">
            Root cause, on demand
          </div>
        </div>
        <form
          onSubmit={submit}
          className="space-y-5 rounded-lg border border-border bg-smoked-onyx p-6"
        >
          <h1 className="text-heading-sm text-warm-off-white">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
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
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="font-mono"
            />
          </div>
          {error && (
            <p className="text-body-sm text-traffic-red">{error}</p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !username || !password}
          >
            {busy
              ? "Working…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </Button>
          <p className="text-body-sm text-bone-gray">
            {mode === "login" ? (
              <>
                No account?{" "}
                <Link
                  href="/register"
                  className="text-pale-stone underline underline-offset-4 hover:text-warm-off-white"
                >
                  Register
                </Link>
              </>
            ) : (
              <>
                Already registered?{" "}
                <Link
                  href="/login"
                  className="text-pale-stone underline underline-offset-4 hover:text-warm-off-white"
                >
                  Sign in
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </main>
  );
}
