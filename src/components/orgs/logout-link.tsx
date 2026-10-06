"use client";

import { LOGIN_PATH } from "@/lib/routes";

/** Sign out from a page outside the app shell (no SessionProvider there). */
export function LogoutLink({ label = "Sign out" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        window.location.assign(LOGIN_PATH);
      }}
      className="text-pale-stone underline underline-offset-4 hover:text-warm-off-white"
    >
      {label}
    </button>
  );
}
