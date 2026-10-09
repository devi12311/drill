import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { cn } from "@/lib/utils";
import type { SkillDraft } from "@/lib/skills/types";

/**
 * The column every skill page sits in, with the way back to the library. Wider
 * while editing, so the procedure and its preview fit side by side.
 */
export function SkillPageFrame({
  wide = false,
  children,
}: {
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-6 pb-20 pt-6",
        wide ? "max-w-[1200px]" : "max-w-[820px]",
      )}
    >
      <Link
        href="/skills"
        className="inline-flex items-center gap-2 text-body-sm text-bone-gray hover:text-warm-off-white"
      >
        <ArrowLeft className="size-3.5" />
        Skills
      </Link>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-caption-tracked uppercase text-bone-gray">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * A skill as something to read — what Holmes will follow — rather than a form:
 * the skill page's view, and the shared copy under review before an import.
 */
export function SkillReader({ draft }: { draft: SkillDraft }) {
  return (
    <div className="space-y-8">
      <Section title="When to use">
        <p className="max-w-[72ch] text-body text-pale-stone">{draft.description}</p>
      </Section>

      <Section title="Inputs">
        {draft.inputs.length === 0 ? (
          <p className="text-body-sm text-bone-gray">
            None — it runs as it is, from whatever you ask alongside it.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {draft.inputs.map((input) => (
              <li key={input.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="font-mono text-[13px] text-pale-stone">{`{{${input.key}}}`}</span>
                <span className="min-w-0 flex-1 text-body-sm text-warm-off-white">{input.label}</span>
                <span className="text-caption-tracked uppercase text-bone-gray">
                  {input.required ? "required" : "optional"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Procedure">
        <Markdown placeholders>{draft.body}</Markdown>
      </Section>
    </div>
  );
}
