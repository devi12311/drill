"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessagesSquare, PenLine, Sparkles } from "lucide-react";
import { CHAT_HOME } from "@/lib/routes";
import { SkillEditor } from "./skill-editor";
import { SkillPageFrame } from "./skill-reader";

const START_OPTIONS = [
  {
    href: "/skills/new?start=holmes",
    icon: Sparkles,
    title: "Describe it to Holmes",
    hint: "Holmes drafts it from your toolsets",
  },
  {
    href: "/skills/new",
    icon: PenLine,
    title: "Write it yourself",
    hint: "Start from an empty form",
  },
  {
    href: CHAT_HOME,
    icon: MessagesSquare,
    title: "From an investigation",
    hint: "Open one in chat → Turn into skill",
  },
] as const;

/**
 * The three ways a skill starts, at the top of the library: one page to see
 * what exists and to start another, instead of a "New skill" button that led
 * to a second page asking the same question.
 */
export function NewSkillOptions() {
  return (
    <section aria-labelledby="new-skill-heading">
      <h2 id="new-skill-heading" className="text-caption-tracked uppercase text-bone-gray">
        New skill
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {START_OPTIONS.map(({ href, icon: Icon, title, hint }) => (
          <Link
            key={title}
            href={href}
            className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 outline-none transition-colors hover:border-slate-hearth hover:bg-smoke-charcoal focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-pale-stone" />
            <span className="min-w-0">
              <span className="block text-body-sm text-warm-off-white">{title}</span>
              <span className="block text-[12px] text-bone-gray">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * `/skills/new` — straight into the form. `?start=holmes` opens it with the
 * Holmes drafter showing; a draft handed over — the chat's skill builder
 * (`?from=conversation`) or a duplicate (`?from=duplicate`) — fills it.
 */
export function NewSkill({ from, start }: { from?: string; start?: string }) {
  const router = useRouter();
  const seeded = from === "conversation" || from === "duplicate" ? from : null;
  return (
    <SkillPageFrame wide>
      <div className="mt-2">
        <SkillEditor
          skill={null}
          source={seeded ? { kind: seeded } : undefined}
          askHolmes={!seeded && start === "holmes"}
          onCancel={() => router.push("/skills")}
        />
      </div>
    </SkillPageFrame>
  );
}
