"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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
  title,
  description,
  confirmLabel,
  destructive,
  comment,
  disabled,
  variant = "outline",
  size,
  className,
  onConfirm,
  children,
}: {
  /** Accessible name for the trigger; `children` may render an icon instead. */
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ask for a note, and pass it to `onConfirm`. */
  comment?: { label: string; placeholder?: string; required?: boolean };
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  onConfirm: (comment: string) => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setNote("");
      }}
    >
      <Button
        type="button"
        variant={destructive ? "destructive" : variant}
        size={size}
        className={className}
        disabled={disabled}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        {children ?? label}
      </Button>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {comment && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-comment">
              {comment.label}
              {!comment.required && (
                <span className="ml-1.5 font-normal text-bone-gray">
                  optional
                </span>
              )}
            </Label>
            <Textarea
              id="confirm-comment"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={comment.placeholder}
              className="h-20"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel />
          <AlertDialogAction
            destructive={destructive}
            disabled={comment?.required ? note.trim().length === 0 : undefined}
            onClick={() => onConfirm(note.trim())}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
