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
  CHAT_WIDTH,
  Investigation,
  RAIL_GRID,
  RailSpacer,
} from "./messages";
import { TurnCard, TurnStatus } from "./turn-card";
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
import { isTypingTarget, useShortcut } from "@/components/shell/shortcuts";
import { useAgentModels } from "@/components/workspace/workspace-provider";
import { invocationLine } from "@/lib/skills/prompt";
import { canRunSkill, type MessageSkill } from "@/lib/skills/types";
import { useSession } from "@/components/session/session-provider";
import { describeDecisions } from "@/lib/chat/describe";
import { groupInvestigations, investigationRows } from "@/lib/chat/investigations";
import { isActiveTurn, type ChatEntry, type TurnSnapshot } from "@/lib/chat/types";
import { viewTransitionSettled } from "@/components/ui/view-transition";
import { SHORTCUTS } from "@/lib/shortcuts";
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
  initialSkill,
  onInitialSkillUsed,
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
  /** A skill name to pick in the composer once (Run ▸ on a skill page). */
  initialSkill?: string | null;
  onInitialSkillUsed?: () => void;
}) {
  const router = useRouter();
  const { user } = useSession();
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [actionError, setActionError] = useState<string | null>(null);
  const models = useAgentModels(agentId);
  const { skills: visibleSkills } = useSkills();
  const runnableSkills = visibleSkills?.filter((s) => canRunSkill(s, user.id)) ?? null;
  // Run ▸ from a skill page: picked once the runnable list has loaded. A name
  // that is not runnable here (deleted, someone else's, always-on) says so.
  const pendingSkill = initialSkill && runnableSkills ? initialSkill : null;
  const skillToRun = pendingSkill
    ? (runnableSkills?.find((s) => s.name === pendingSkill) ?? null)
    : null;
  const [unknownSkill, setUnknownSkill] = useState<string | null>(null);
  if (pendingSkill && !skillToRun && unknownSkill !== pendingSkill) setUnknownSkill(pendingSkill);
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
  useEffect(() => {
    if (!pendingSkill) return;
    if (skillToRun) composerRef.current?.run(skillToRun);
    onInitialSkillUsed?.();
  }, [pendingSkill, skillToRun, onInitialSkillUsed]);
  // From Send until the server hands back a turn id: the card shows "Starting…"
  // at once instead of a gap, and it is the same TurnCard the real turn then
  // fills — so the orb that flew in on the first send is never remounted.
  const [pendingTurn, setPendingTurn] = useState<TurnView | null>(null);
  const [stopClickedAt, setStopClickedAt] = useState<number | null>(null);

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

  // The transcript follows what is said — a send, an answer, a turn that
  // stopped — never the tool calls, which grow inside their own rail. And only
  // while the reader is at the bottom: reading back must not be yanked away.
  const turnOutcome =
    view && !isActiveTurn(view.turn.status) ? `${view.turn.id}:${view.turn.status}` : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current)
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [entries, turnOutcome]);

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

  /** Answers the pending approval; the line is the one the server stores. */
  function decide(decisions: ToolApprovalDecision[]) {
    const pending = entries[entries.length - 1]?.response?.pending_approvals;
    return run(describeDecisions(pending, decisions), { tool_decisions: decisions });
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

  function stop() {
    setStopClickedAt(Date.now());
    turnAction("cancel");
  }

  function onFollowUp(action: FollowUpAction) {
    send(action.prompt, action.pre_action_notification_text);
  }

  const empty = entries.length === 0 && !view;
  const shownTurn = view ?? pendingTurn;
  const investigations = groupInvestigations(entries);
  // The turn is always the last investigation's: its line (question or
  // decision) is in the transcript from Send on.
  if (shownTurn && investigations.length === 0)
    investigations.push({ id: shownTurn.turn.id, question: null, parts: [] });
  const lastInvestigation = investigations.at(-1);
  // Compared with statusSince rather than reset in an effect: any status change
  // (stopped, then resumed) is newer than the click, so Stop comes back.
  const stopping =
    stopClickedAt != null && view != null && stopClickedAt >= view.statusSince;

  // Esc stops the investigation, as in Claude and Claude Code — after anything
  // nearer has had it (a dialog, the skill list, a picked skill), and not from
  // another field. A stray press is cheap: a stopped turn can be resumed.
  useShortcut(
    SHORTCUTS.stop.keys,
    (e) => {
      const fromField = isTypingTarget(e.target) && !(e.target as Element).closest("[data-composer]");
      if (fromField) return false;
      stop();
    },
    active && !stopping,
  );
  const liveStatus =
    shownTurn && lastInvestigation && isActiveTurn(shownTurn.turn.status) ? (
      <TurnStatus
        view={shownTurn}
        calls={investigationRows(lastInvestigation, shownTurn.items).calls}
        stopping={stopping}
      />
    ) : null;

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
          "@container/chat flex h-full min-w-0 flex-1 flex-col",
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
            // Both-edges gutter: the scrollbar would otherwise shift the centred
            // column left of the composer below it. A size container once there
            // is a transcript (it is flex-sized then, never content-sized), so
            // the rail can be capped to exactly the visible height (`cqh`).
            className={cn(
              "min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]",
              empty ? "flex-initial" : "flex-1 [container-type:size]",
            )}
          >
            <div className={empty ? "mx-auto w-full max-w-[820px] px-6" : CHAT_WIDTH}>
              {empty ? (
                <ChatHero />
              ) : (
                <div data-transcript className="space-y-10 py-8">
                  {investigations.map((inv) => {
                    const turn = inv === lastInvestigation ? shownTurn : null;
                    return (
                      <Investigation
                        key={inv.id}
                        inv={inv}
                        live={
                          turn
                            ? {
                                items: turn.items,
                                active: isActiveTurn(turn.turn.status),
                                card: (
                                  <TurnCard
                                    view={turn}
                                    onResume={() => turnAction("resume")}
                                    onDismiss={() => turnAction("dismiss")}
                                  />
                                ),
                              }
                            : undefined
                        }
                        isLatest={inv === lastInvestigation}
                        busy={active}
                        onFollowUp={onFollowUp}
                        onDecide={decide}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SkillBuilderContext.Provider>
        {/*
          The mode island is fixed in the bottom-right, where it would sit on the
          composer's send button. Reserve room for it — only for the admins who
          see it, and only while the pane leaves no margin of its own: below
          ~940px for the 820px column, and again just past the rail breakpoint
          (globals.css `rail`, 1100px), where the column widens to fill the pane.
        */}
        <div
          className={cn(
            empty ? "mx-auto w-full max-w-[820px] px-6" : [CHAT_WIDTH, RAIL_GRID],
            "pb-6 pt-2",
            showsModeSwitch(user) &&
              "pr-20 @min-[940px]/chat:pr-6 @min-[1100px]/chat:pr-20 @min-[1220px]/chat:pr-6",
          )}
        >
          {!empty && <RailSpacer />}
          <div className="min-w-0">
            {picking ? (
              <SkillBuilderBar builder={builder} />
            ) : (
              <>
                {(actionError || unknownSkill) && (
                  <p className="mb-2 text-body-sm text-destructive">
                    {actionError ?? `There is no skill named ${unknownSkill} that you can run here.`}
                  </p>
                )}
                <Composer
                  ref={composerRef}
                  onSend={(ask, skillRun) => (skillRun ? runSkill(ask, skillRun) : send(ask))}
                  onStop={stop}
                  busy={active}
                  stopping={stopping}
                  status={liveStatus}
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
