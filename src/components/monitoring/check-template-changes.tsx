"use client";

import { useTechnologies } from "@/components/monitoring/technologies-provider";
import { DefinitionBlock } from "@/components/monitoring/definition-modal";
import { REQUIREMENT_LABEL, SEVERITY_LABEL, describeScope } from "@/lib/monitoring/ui";
import type { CheckRequirement, CheckView } from "@/lib/monitoring/types";

/**
 * What the shared template now says, field by field, where it differs from the
 * org's copy — shown when the template moved on since the copy was made
 * (decision 126). Only differing fields are listed, so "Keep my version" and
 * "Reset to template" are decided on the actual change, not on two full texts.
 */
const fields = (
  technology: (slug: string) => string,
): { label: string; read: (c: CheckView) => string }[] => [
  { label: "Title", read: (c) => c.title },
  { label: "Question", read: (c) => c.question },
  { label: "Evidence", read: (c) => c.evidence },
  { label: "Severity", read: (c) => SEVERITY_LABEL[c.baseSeverity] },
  { label: "Scope", read: (c) => describeScope(c, technology) },
  {
    label: "Needs",
    read: (c) =>
      c.requires
        ? (REQUIREMENT_LABEL[c.requires as CheckRequirement] ?? c.requires)
        : "nothing special",
  },
  { label: "Auto-resolves after", read: (c) => `${c.resolveAfterAbsentRuns} clean run(s)` },
  { label: "Cites", read: (c) => c.reference || "—" },
];

export function CheckTemplateChanges({
  mine,
  template,
}: {
  mine: CheckView;
  template: CheckView;
}) {
  const { label } = useTechnologies();
  const changed = fields(label).filter((f) => f.read(mine) !== f.read(template));
  return (
    <DefinitionBlock label="The shared template changed">
      {changed.length === 0 ? (
        <p className="text-body-sm text-bone-gray">
          Its wording now matches your copy — choose “Keep my version” to clear
          this notice.
        </p>
      ) : (
        <dl className="space-y-2 rounded-md border border-border bg-smoked-onyx/40 p-3">
          {changed.map((f) => (
            <div key={f.label}>
              <dt className="text-caption-tracked uppercase text-bone-gray">
                {f.label} — template now
              </dt>
              <dd className="max-w-[90ch] text-body-sm text-pale-stone">
                {f.read(template)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </DefinitionBlock>
  );
}
