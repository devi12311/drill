"use client";

import { DrillOrb, ORB_INK } from "./orb";

/** `select` is the placeholder picked for the user to type over. */
const EXAMPLE_ASKS = [
  { ask: "Why is deployment X crash-looping in namespace Y?", select: "X" },
  { ask: "Summarize the health of the database StatefulSets in namespace Z", select: "Z" },
  { ask: "What is wrong with trace id …? Suggest a fix in the code.", select: "…" },
];

/** A new conversation's hero, sitting directly above the composer. */
export function ChatHero() {
  return (
    <div data-chat-hero className="flex flex-col items-center pb-8 pt-10 text-center">
      {/*
        A wash of the ink behind the orb gives it presence on the dark canvas
        without a box-shadow. On the first send the wash leaves with the hero
        while the orb itself flies into the turn's status row.
      */}
      <div
        className="mb-6 grid size-32 place-items-center rounded-full animate-in fade-in-0 zoom-in-95 duration-700 motion-reduce:animate-none"
        style={{ background: `radial-gradient(closest-side, ${ORB_INK}1a, transparent)` }}
      >
        <DrillOrb state="composing" size={64} speed={0.8} />
      </div>
      <h1 className="text-heading text-warm-off-white">Ask the cluster.</h1>
      <p className="mt-2 max-w-[52ch] text-body text-pale-stone">
        Traces, logs, metrics, databases and deployed code — Drill investigates across
        all of it and comes back with a root cause.
      </p>
    </div>
  );
}

/** Starting points under the composer; picking one drafts it, it never sends. */
export function ExampleAsks({ onPick }: { onPick: (ask: string, select: string) => void }) {
  return (
    <div className="mt-3 flex flex-col">
      {EXAMPLE_ASKS.map(({ ask, select }) => (
        <button
          key={ask}
          type="button"
          onClick={() => onPick(ask, select)}
          className="group flex items-baseline gap-3 rounded-sm px-4 py-1.5 text-left font-mono text-body-sm text-bone-gray hover:bg-smoked-onyx hover:text-pale-stone"
        >
          <span aria-hidden className="text-slate-hearth group-hover:text-pale-stone">
            →
          </span>
          {ask}
        </button>
      ))}
    </div>
  );
}
