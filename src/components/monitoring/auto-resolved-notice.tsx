"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";

/**
 * "Saving that edit closed N concerns" — announced on the job page, because that
 * is where the operator lands after saving.
 *
 * Disabling a check in a job auto-resolves the open concerns citing it, and that
 * is a change to recorded history: it has to be said out loud. It used to be said
 * as a line of green text directly above the submit button — i.e. at the bottom
 * of a form two viewports tall, immediately before the form stopped being the
 * thing on screen. The count travels in the URL instead, and the param is cleaned
 * up with `replaceState` so a reload does not re-announce it and Back does not
 * bring it back.
 */
export function AutoResolvedNotice() {
  const params = useSearchParams();
  // Read once, on mount: the effect below immediately strips the param, so
  // deriving the count on every render would make the notice vanish again.
  const [count] = useState(() => {
    const raw = Number(params.get("autoResolved"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  });

  useEffect(() => {
    if (count === null) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("autoResolved");
    const qs = next.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [count]);

  if (count === null) return null;
  return (
    <Card className="border-traffic-green/40 p-4">
      <p className="text-body-sm text-pale-stone">
        Saved.{" "}
        {count === 1
          ? "One open concern was resolved, because the check it cites no longer runs in this job."
          : `${count} open concerns were resolved, because the checks they cite no longer run in this job.`}
      </p>
    </Card>
  );
}
