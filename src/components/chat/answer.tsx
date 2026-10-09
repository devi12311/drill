import { ChevronRight } from "lucide-react";
import {
  ANSWER_HEADINGS,
  splitAnswer,
} from "@/lib/chat/answer-style";
import { Markdown } from "./markdown";

/**
 * A Holmes answer. One in the brief format (lib/chat/answer-style.ts) reads as a
 * card — Problem, Fix, Verify — with the evidence folded underneath; anything
 * else (detailed mode, a plain status reply, answers from before the format)
 * renders as the markdown it is.
 */
export function Answer({ analysis }: { analysis: string }) {
  const split = splitAnswer(analysis);
  if (!split) return <Markdown>{analysis}</Markdown>;
  return (
    <div className="space-y-3">
      {split.lead && <Markdown>{split.lead}</Markdown>}
      {split.sections.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border bg-smoked-onyx">
          {split.sections.map((section) => (
            <section key={section.key} className="px-5 py-4">
              <h3 className="text-caption-tracked mb-2 uppercase text-bone-gray">
                {ANSWER_HEADINGS[section.key]}
              </h3>
              <Markdown>{section.body}</Markdown>
            </section>
          ))}
        </div>
      )}
      {split.details && (
        <details className="group rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-body-sm text-pale-stone hover:text-warm-off-white [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
            {ANSWER_HEADINGS.details}
          </summary>
          <div className="border-t border-border px-5 py-4">
            <Markdown>{split.details}</Markdown>
          </div>
        </details>
      )}
    </div>
  );
}
