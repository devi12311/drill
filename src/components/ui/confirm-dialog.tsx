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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ask for a note, and pass it to `onConfirm`. */
  comment?: { label: string; placeholder?: string; required?: boolean };
  onConfirm: (comment: string) => void;
}

/**
 * The confirmation itself, opened by whoever owns `open` — a menu item or a
 * radio choice, which cannot be the dialog's trigger. `ConfirmButton` is this
 * plus a button.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  comment,
  onConfirm,
}: ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = React.useState("");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setNote("");
      }}
    >
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
