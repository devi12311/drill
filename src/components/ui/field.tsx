"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One form field: label, optionality, control, description, error, counter.
 *
 * It exists because three forms in this module each invented their own field
 * layout, and the result was a survey of conventions rather than a convention.
 * Across eighteen fields exactly one said whether it was optional, six had no
 * description at all, several had a silent default that decided real behaviour,
 * and every length cap was invisible until the server rejected the save.
 *
 * The rules this fixes in one place:
 *
 * - **Optional is marked; required is not.** Most fields here are required, so
 *   marking the exception is both shorter and the thing worth reading. It is a
 *   convention only if it is applied to every field, which is what this enforces.
 * - **A description is the norm.** If a field's consequence is not obvious from
 *   its label — and in this module it usually is not — `description` says it.
 * - **A capped field shows its budget**, and only once it matters, so the counter
 *   is information rather than decoration.
 * - **Errors sit with their field**, wired to `aria-invalid` and `aria-describedby`
 *   on the control, instead of accumulating in one paragraph at the foot of a
 *   scrolling dialog where a long form puts them off-screen.
 */
export function Field({
  id,
  label,
  description,
  optional,
  error,
  value,
  limit,
  className,
  children,
}: {
  /** Must match the control's `id`; the label and the wiring both depend on it. */
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  optional?: boolean;
  error?: string | null;
  /** Supply with `limit` to show a counter. */
  value?: string;
  limit?: number;
  className?: string;
  /**
   * The control. Called with the props that wire up the description and the
   * error, so a field cannot be labelled correctly and described incorrectly.
   */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
  }) => React.ReactNode;
}) {
  const describedBy =
    [description ? `${id}-description` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const used = value?.length ?? 0;
  // Silent until you are close enough to care. A counter on an empty box is noise.
  const showCounter = limit !== undefined && used > limit * 0.7;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>
          {label}
          {optional && (
            <span className="ml-1.5 font-normal text-bone-gray">optional</span>
          )}
        </Label>
        {showCounter && (
          <span
            className={cn(
              "text-caption-tracked",
              used > limit ? "text-traffic-red" : "text-bone-gray",
            )}
          >
            {used} / {limit}
          </span>
        )}
      </div>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {description && (
        <p
          id={`${id}-description`}
          className="max-w-[80ch] text-body-sm text-bone-gray"
        >
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-body-sm text-traffic-red">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A group of related fields under one heading, with a line saying what the group
 * decides.
 *
 * The forms were flat lists in which "what Holmes must determine" — the field the
 * whole check exists to carry — had exactly the same weight as "unit". A named
 * section with a purpose is how a reader knows which decisions are theirs to make
 * and which have a sane default.
 */
export function FieldGroup({
  title,
  purpose,
  children,
}: {
  title: string;
  purpose?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="space-y-0.5">
        <span className="block text-caption-tracked uppercase text-bone-gray">
          {title}
        </span>
        {purpose && (
          <span className="block max-w-[80ch] text-body-sm text-bone-gray">
            {purpose}
          </span>
        )}
      </legend>
      {children}
    </fieldset>
  );
}
