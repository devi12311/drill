"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth/me";

interface SessionContextValue {
  user: SessionUser;
  /** Clear the cookie and land on /login. */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holds the logged-in user for every client component under the `(app)` shell.
 *
 * The value is **server-rendered** by `(app)/layout.tsx` — no fetch-on-mount,
 * so no "…" flash for the username or the admin chrome. Before this existed,
 * three components each fetched `/api/auth/me` on mount and disagreed for a
 * frame. It needs no client-side refresh either: every flow that changes who
 * you are (login, logout, impersonate start/stop) does a full navigation, which
 * re-runs the server layout.
 */
export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }, [router]);

  const value = useMemo(() => ({ user, logout }), [user, logout]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/** The logged-in user. Only valid inside the `(app)` shell. */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
