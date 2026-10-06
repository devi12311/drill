"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORG_NAME_MAX } from "@/lib/orgs/types";
import { reloadInto, sendJson } from "./org-actions";

/** Start a new org (you become its owner) and switch into it. */
export function NewOrgForm({ onCancel }: { onCancel?: () => void }) {
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson("/api/orgs", { name });
      reloadInto(pathname);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-name" className="text-pale-stone">
          Name
        </Label>
        <Input
          id="org-name"
          autoFocus
          maxLength={ORG_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Platform team"
        />
      </div>
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </div>
    </form>
  );
}

export function NewOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] gap-4">
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>
            A separate workspace with its own agents, clusters, skills and
            resolutions. You will be its owner and can invite others.
          </DialogDescription>
        </DialogHeader>
        {open && <NewOrgForm onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
