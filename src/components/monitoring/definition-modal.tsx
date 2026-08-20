"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The reading (and editing) layer for one definition.
 *
 * It is a modal for a reason that is not fashion: the monitoring module's
 * content column is 900px wide and shared with the cluster and job pages, while
 * a playbook is the widest content in the app — a method, its data-source
 * bindings and twenty-odd measurement specs. Inside the column that table was
 * pushed to `overflow-x-auto` and the field that most needed room got about
 * thirty characters of it. The modal is the only surface that gets real width
 * without changing the frame everything else sits in.
 *
 * Which definition is open lives in the URL rather than in component state, so
 * a specific check is linkable in a review and the back button closes the panel
 * instead of leaving the page.
 */

export function useDefinitionParam(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(key);

  const set = useCallback(
    (next: string | null) => {
      const query = new URLSearchParams(params.toString());
      if (next) query.set(key, next);
      else query.delete(key);
      const qs = query.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      // Opening PUSHES so that Back closes the panel; closing REPLACES so that
      // Back from the closed page does not immediately reopen it.
      if (next) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [key, params, pathname, router],
  );

  return [value, set] as const;
}

export function DefinitionModal({
  open,
  onClose,
  title,
  identifier,
  description,
  badges,
  children,
  /**
   * Consulted before every close — Escape, the overlay, the X and the footer's
   * own Cancel all route through here. Return false to keep the panel open;
   * this is what stops an in-progress edit from evaporating on a stray click.
   */
  confirmClose,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** The stable ID, set in mono beside the title. */
  identifier?: React.ReactNode;
  description?: React.ReactNode;
  badges?: React.ReactNode;
  /**
   * The panel below the header — a `DialogBody` and a `ModalFooter`. Handed over
   * whole rather than split into body/footer props because in edit mode both
   * halves belong to the same `<form>`: the footer's Save is the form's submit,
   * and its disabled state is the form's own dirty flag, neither of which should
   * have to be lifted into the page to be rendered.
   */
  children: React.ReactNode;
  confirmClose?: () => boolean;
}) {
  function requestClose() {
    if (confirmClose && !confirmClose()) return;
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      {/* Radix wires aria-describedby to the description; with no description
          the explicit undefined is its documented opt-out, and skips the
          "missing Description" console warning. */}
      <DialogContent size="lg" {...(description ? {} : { "aria-describedby": undefined })}>
        <DialogHeader className="pr-10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DialogTitle className="text-body text-warm-off-white">
              {title}
            </DialogTitle>
            {identifier && (
              <span className="font-mono text-[12px] text-muted-cobalt">
                {identifier}
              </span>
            )}
            {badges}
          </div>
          {description && (
            <DialogDescription className="max-w-[90ch] text-body-sm text-bone-gray">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The panel's action bar. Pinned below the scrolling body rather than parked at
 * the end of it — a playbook editor is some two thousand pixels tall, and a Save
 * button you have to go and find is a Save button that gets forgotten.
 */
export function ModalFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-border pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A labelled block inside the modal body. One component so the read view of a
 * check and the read view of a playbook cannot drift into two typographies.
 */
export function DefinitionBlock({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5 border-t border-border pt-3", className)}>
      <p className="text-caption-tracked uppercase text-bone-gray">{label}</p>
      {children}
    </div>
  );
}

/**
 * A field group folded down to one line.
 *
 * `summary` is not decoration — it is the closed state's whole job. The check
 * editor hides some forty checkboxes behind "Deployments & StatefulSets · only
 * PostgreSQL", and a disclosure whose closed state does not say what is inside
 * is just a place for settings to go missing.
 */
export function Disclosure({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40">
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-bone-gray transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 text-body-sm font-medium text-warm-off-white">
          {label}
        </span>
        {!open && summary && (
          <span className="min-w-0 flex-1 truncate text-body-sm text-bone-gray">
            {summary}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-border px-3 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
