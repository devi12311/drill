"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Composer, type ComposerHandle, type SkillRun } from "./composer";
import { loadConversation } from "./conversation-api";
import { ChatHero, ExampleAsks } from "./empty-state";
import {
  AssistantMessage,
  UserMessage,
  type ChatEntry,
} from "./messages";
import { TurnCard } from "./turn-card";
import { freshView, useTurnStream, type TurnView } from "./use-turn-stream";
import { ResolveDialog } from "@/components/resolutions/resolve-dialog";
import { useSkills } from "@/components/skills/use-skills";
import {
  SkillBuilderBar,
  SkillBuilderPanel,
} from "@/components/skills/skill-builder-rail";
import {
  SkillBuilderContext,
  useSkillBuilderState,
} from "@/components/skills/use-skill-builder";
import { showsModeSwitch } from "@/components/shell/mode-switch";
import { useAgentModels } from "@/components/workspace/workspace-provider";
import { invocationLine } from "@/lib/skills/prompt";
import type { MessageSkill } from "@/lib/skills/types";
import { useSession } from "@/components/session/session-provider";
import { isActiveTurn, type TurnSnapshot } from "@/lib/chat/types";
import { viewTransitionSettled } from "@/components/ui/view-transition";
import { cn } from "@/lib/utils";
import type {
  FollowUpAction,
  ToolApprovalDecision,
} from "@/lib/holmes/types";

/** Within this many px of the bottom, new progress keeps the view pinned there. */
const STICK_PX = 120;

/** What a just-queued turn looks like until its stream sends the real row. */
function queuedTurn(id: string): TurnSnapshot {
  return {
    id,
    status: "queued",
    attempt: 0,
    error: null,
    resumable: true,
    createdAt: new Date().toISOString(),
    startedAt: null,
  };
}

async function postTurnAction(turnId: string, action: string) {
  const res = await fetch(`/api/chat/turns/${turnId}/${action}`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
}

export function Chat({
  agentId,
  initialConversationId,
  initialEntries,
  initialTurn,
  status,
  artifactId,
  onConversationCreated,
  onActivity,
}: {
  agentId: string;
  initialConversationId: string | null;
  initialEntries: ChatEntry[];
  /** The conversation's open turn when it was opened — reattached on mount. */
  initialTurn: TurnSnapshot | null;
  /** Resolution state of the active conversation (from the sidebar list). */
  status?: "open" | "resolved";
  artifactId?: string | null;
  onConversationCreated: (id: string) => void;
  /** Something the sidebar shows changed (a turn started, settled, stopped). */
  onActivity: () => void;
}) {
  const router = useRouter();
  const { user } = useSession();
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [actionError, setActionError] = useState<string | null>(null);
  const models = useAgentModels(agentId);
  const { skills: visibleSkills } = useSkills();
  // What the server will run for this user: their own and shared skills. An
  // admin's list also holds other users' private ones, and always-on skills
  // already apply to every turn.
  const runnableSkills =
    visibleSkills?.filter(
      (s) => !s.alwaysOn && (s.visibility === "shared" || s.createdBy === user.id),
    ) ?? null;
  const [pickedModel, setModel] = useState<string | null>(null);
  // Derived, not stored: the agent's first model IS the default, and a pick
  // the agent no longer serves (or one from another agent) falls back to it.
  const model =
    pickedModel && models?.includes(pickedModel)
      ? pickedModel
      : (models?.[0] ?? null);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [resolveOpen, setResolveOpen] = useState(false);
  const conversationIdRef = useRef<string | null>(initialConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const composerRef = useRef<ComposerHandle>(null);
  // From Send until the server hands back a turn id: the card shows "Starting…"
  // at once instead of a gap, and it is the same TurnCard the real turn then
  // fills — so the orb that flew in on the first send is never remounted.
  const [pendingTurn, setPendingTurn] = useState<TurnView | null>(null);

  /** Messages are the one source of truth once a turn settles or is dismissed. */
  const refresh = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id) return null;
    try {
      const loaded = await loadConversation(id);
      setEntries(loaded.entries);
      return loaded;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reload");
      return null;
    }
  }, []);

  const { view, follow, resume, clear } = useTurnStream(
    initialTurn,
    async (followNext) => {
      const loaded = await refresh();
      // Another tab may have queued the next question already.
      if (loaded?.turn) followNext(loaded.turn);
      onActivity();
    },
  );
  const active = view != null && isActiveTurn(view.turn.status);
  const hasAnswer = entries.some((e) => e.role === "assistant" && e.response);
  const builder = useSkillBuilderState(entries, conversationId);
  const picking = builder.picking;
  const turnIntoSkillBlocked = active || !conversationId
    ? "Wait for the investigation to finish"
    : builder.addableCount === 0
      ? "No tool calls to build from"
      : null;

  // Picking starts on the first call — focused without moving the view.
  useEffect(() => {
    if (!picking) return;
    scrollRef.current
      ?.querySelector<HTMLElement>("[data-pick-key]")
      ?.focus({ preventScroll: true });
  }, [picking]);

  async function unresolve() {
    if (!artifactId) return;
    await fetch(`/api/artifacts/${artifactId}`, { method: "DELETE" }).catch(
      () => null,
    );
    onActivity();
  }

  // Follow the progress only while the reader is at the bottom: expanding a
  // tool's output mid-investigation must not be yanked away by the next event.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current)
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [entries, view, pendingTurn]);

  function send(ask: string, preNotice?: string) {
    return run(ask, { ask }, preNotice);
  }

  /** An explicit skill run; the line mirrors what the server stores. */
  function runSkill(ask: string, { skill, values }: SkillRun) {
    const filled = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
    );
    return run(
      invocationLine(skill, filled, ask),
      { ask, skill: { id: skill.id, inputs: filled } },
      undefined,
      { id: skill.id, name: skill.name },
    );
  }

  /** Answers the pending approval; the summary mirrors what the server stores. */
  function decide(decisions: ToolApprovalDecision[]) {
    const pending =
      entries[entries.length - 1]?.response?.pending_approvals ?? [];
    const summary = decisions
      .map((d) => {
        const name =
          pending.find((a) => a.tool_call_id === d.tool_call_id)?.tool_name ??
          "tool";
        if (d.approved) return `Approved ${name}`;
        return d.feedback ? `Denied ${name}: ${d.feedback}` : `Denied ${name}`;
      })
      .join("\n");
    return run(summary, { tool_decisions: decisions });
  }

  /**
   * Queue a turn and follow it. Resolves false when nothing was queued, so the
   * composer can put the question back.
   */
  async function run(
    userLine: string,
    payload:
      | { ask: string; skill?: { id: string; inputs: Record<string, string> } }
      | { tool_decisions: ToolApprovalDecision[] },
    preNotice?: string,
    skill?: MessageSkill,
  ): Promise<boolean> {
    if (!model) return false;
    setActionError(null);
    stickRef.current = true;
    // Sending over a stopped turn files it into the transcript server-side.
    const replacesStopped = view != null && !active;
    const optimisticId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      { id: optimisticId, role: "user", ask: userLine, skill },
    ]);
    setPendingTurn(freshView(queuedTurn(optimisticId), preNotice));
    const unsend = () => {
      setPendingTurn(null);
      setEntries((prev) => prev.filter((e) => e.id !== optimisticId));
    };
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          model,
          agent_id: agentId,
          conversation_id: conversationIdRef.current ?? undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      // On the first send the POST is back mid-animation; adopting the id,
      // rewriting the URL and attaching the stream would stall it. The pending
      // card already says "Starting…", and the worker runs the turn regardless.
      await viewTransitionSettled();
      if (res.status === 409 && body?.turn_id) {
        // Already investigating here — started from another tab. Show that one.
        unsend();
        const loaded = await refresh();
        if (loaded?.turn) follow(loaded.turn);
        setActionError(
          "An investigation is already running in this conversation — showing it. Send again once it finishes.",
        );
        return false;
      }
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      if (!conversationIdRef.current) {
        conversationIdRef.current = body.conversation_id;
        setConversationId(body.conversation_id);
        onConversationCreated(body.conversation_id);
      }
      if (replacesStopped) {
        clear();
        await refresh();
      }
      setPendingTurn(null);
      follow(queuedTurn(body.turn_id), preNotice);
      onActivity();
      return true;
    } catch (err) {
      unsend();
      setActionError(err instanceof Error ? err.message : "Could not send");
      return false;
    }
  }

  async function turnAction(action: "cancel" | "resume" | "dismiss") {
    if (!view) return;
    setActionError(null);
    try {
      await postTurnAction(view.turn.id, action);
      if (action === "resume") resume();
      if (action === "dismiss") {
        clear();
        await refresh();
      }
      onActivity();
    } catch (err) {
      // A Stop that lands after the answer is not an error worth showing.
      if (action !== "cancel")
        setActionError(err instanceof Error ? err.message : "Request failed");
    }
  }

  function onFollowUp(action: FollowUpAction) {
    send(action.prompt, action.pre_action_notification_text);
  }

  const empty = entries.length === 0 && !view;
  const shownTurn = view ?? pendingTurn;

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/*
        A new chat centres the hero and the composer together; the first message
        lets the transcript take the height and the composer docks at the bottom.
        The composer is never re-parented for this — moving it would remount it
        and lose a draft that a failed send puts back.
      */}
      <div
        data-chat-empty={empty || undefined}
        className={cn(
          "flex h-full min-w-0 flex-1 flex-col",
          empty && "justify-center pb-[8vh]",
        )}
      >
        {/*
          Shown from the first message, not from when the server returns the
          conversation id: appearing ~100ms later would shift the transcript
          under the first-send transition. Its actions stay disabled until
          there is an answer (resolve) or tool calls (skill) anyway.
        */}
        {!empty && (
          <div className="flex items-center justify-end gap-2 border-b border-border px-6 py-2">
            <Button
              variant="secondary"
              size="sm"
              className="gap-2 aria-pressed:bg-iron-veil aria-pressed:text-warm-off-white"
              aria-pressed={picking}
              disabled={!picking && turnIntoSkillBlocked !== null}
              title={picking ? "Leave the skill builder" : (turnIntoSkillBlocked ?? undefined)}
              onClick={() => (picking ? builder.stop() : builder.start())}
            >
              <ListChecks className="size-4" />
              Turn into skill
            </Button>
            {status === "resolved" ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={picking}
                  className="flex items-center gap-2 rounded-sm border border-input px-3 py-1.5 text-body-sm text-pale-stone hover:bg-smoke-charcoal hover:text-warm-off-white disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="size-1.5 rounded-full bg-traffic-green" />
                  Resolved
                  <ChevronDown className="size-3.5 text-bone-gray" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      artifactId && router.push(`/resolutions/${artifactId}`)
                    }
                  >
                    View artifact
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setResolveOpen(true)}>
                    Re-resolve (regenerate)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={unresolve}>
                    Unresolve
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="gap-2"
                disabled={!hasAnswer || active || picking}
                onClick={() => setResolveOpen(true)}
              >
                <CheckCircle2 className="size-4 text-traffic-green" />
                Mark resolved
              </Button>
            )}
          </div>
        )}
        <SkillBuilderContext.Provider value={picking ? builder : null}>
          <div
            ref={scrollRef}
            onKeyDown={picking ? builder.onKeyDown : undefined}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
            }}
            className={cn("min-h-0 overflow-y-auto", empty ? "flex-initial" : "flex-1")}
          >
            <div className="mx-auto w-full max-w-[820px] px-6">
              {empty ? (
                <ChatHero />
              ) : (
                <div data-transcript className="space-y-8 py-8">
                  {entries.map((entry, i) =>
                    entry.role === "user" ? (
                      <UserMessage key={entry.id} ask={entry.ask!} skill={entry.skill} />
                    ) : (
                      <AssistantMessage
                        key={entry.id}
                        entry={entry}
                        onFollowUp={onFollowUp}
                        onDecide={decide}
                        busy={active}
                        isLatest={i === entries.length - 1}
                      />
                    ),
                  )}
                  {shownTurn && (
                    <TurnCard
                      view={shownTurn}
                      onStop={view ? () => turnAction("cancel") : undefined}
                      onResume={() => turnAction("resume")}
                      onDismiss={() => turnAction("dismiss")}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </SkillBuilderContext.Provider>
        {/*
          The mode island is fixed in the bottom-right, where it would sit on the
          composer's send button on narrow viewports. Reserve room for it — but
          only for the admins who actually see it, and only below xl, where the
          centred column no longer leaves that margin on its own.
        */}
        <div
          className={cn(
            "mx-auto w-full max-w-[820px] px-6 pb-6 pt-2",
            showsModeSwitch(user) && "pr-20 xl:pr-6",
          )}
        >
          {picking ? (
            <SkillBuilderBar builder={builder} />
          ) : (
            <>
              {actionError && (
                <p className="mb-2 text-body-sm text-destructive">{actionError}</p>
              )}
              <Composer
                ref={composerRef}
                onSend={(ask, skillRun) => (skillRun ? runSkill(ask, skillRun) : send(ask))}
                onStop={() => turnAction("cancel")}
                busy={active}
                models={models}
                model={model}
                onModelChange={setModel}
                skills={runnableSkills}
                // Survives leaving for Skills and coming back (the pane remounts).
                draftKey={initialConversationId ?? `new:${agentId}`}
                // Only the first send changes the page's shape; later ones just append.
                animateSend={empty}
              />
              {empty && (
                <ExampleAsks onPick={(ask, select) => composerRef.current?.fill(ask, select)} />
              )}
            </>
          )}
        </div>
      </div>
      {picking && <SkillBuilderPanel builder={builder} />}
      {conversationId && (
        <ResolveDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          conversationId={conversationId}
          onResolved={() => onActivity()}
        />
      )}
    </div>
  );
}
