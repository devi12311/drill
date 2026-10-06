"use client";

import { LOGIN_PATH } from "@/lib/routes";

/**
 * Sign out from a page outside the app shell (no SessionProvider there). `to`
 * is where to land: an invitation sends you back to itself, to sign in as the
 * right account or sign up.
 */
export function LogoutLink({
  label = "Sign out",
  to = LOGIN_PATH,
}: {
  label?: string;
  to?: string;
}) {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        window.location.assign(to);
      }}
      className="text-pale-stone underline underline-offset-4 hover:text-warm-off-white"
    >
      {label}
    </button>
  );
}
