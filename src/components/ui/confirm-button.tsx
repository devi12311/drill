"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmOptions } from "@/components/ui/confirm-dialog";

/**
 * A button whose action is confirmed first, and which can collect a note.
 *
 * One component rather than a dialog wired up at each of the seven call sites
 * that used `window.confirm`/`window.prompt`, because what those sites all
 * needed was the same thing: say what will happen, let it be declined, and
 * (sometimes) take the sentence that goes in the audit log.
 */
export function ConfirmButton({
  label,
  disabled,
  variant,
  size,
  className,
  children,
  ...confirm
}: ConfirmOptions & {
  /** Accessible name for the trigger; `children` may render an icon instead. */
  label: string;
  disabled?: boolean;
  /**
   * The trigger's look. Defaults to destructive for a destructive action, else
   * outline; set it explicitly for a quiet trigger (an icon in a list row) whose
   * confirm button should still be red.
   */
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant ?? (confirm.destructive ? "destructive" : "outline")}
        size={size}
        className={className}
        disabled={disabled}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        {children ?? label}
      </Button>
      <ConfirmDialog {...confirm} open={open} onOpenChange={setOpen} />
    </>
  );
}
