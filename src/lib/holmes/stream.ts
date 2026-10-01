import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { runSearchTool, SEARCH_TOOL_NAME } from "@/lib/artifacts/search";
import type {
  ConversationMessage,
  FrontendToolResult,
  HolmesChatRequest,
  HolmesChatResponse,
  PendingFrontendToolCall,
  PendingToolApproval,
  ToolCall,
} from "./types";
import {
  answerFromPayload,
  connectionLost,
  openHolmesStream,
  type AgentTarget,
} from "./sse";

const INVESTIGATION_TIMEOUT_MS = 15 * 60 * 1000;
/** Backstop against Holmes calling the knowledge tool in a loop. */
const MAX_FRONTEND_TOOL_ROUNDS = 4;

/**
 * Drill's normalized stream events: Holmes SSE (or the fixture simulator)
 * mapped server-side. The chat runner saves all but `done` as the turn's
 * progress (lib/chat/types.ts TurnEvent); the answer itself comes from the
 * StreamOutcome, since `done.response` has conversation_history stripped.
 */
export type DrillEvent =
  | { type: "tool_start"; id: string; tool_name: string }
  | { type: "tool_result"; toolCall: ToolCall }
  | { type: "ai_message"; content: string }
  | {
      type: "done";
      response: Omit<HolmesChatResponse, "conversation_history">;
      drill_duration_ms: number;
    };

/** Full response including history — for persistence, never sent to the client. */
export interface StreamOutcome {
  response: HolmesChatResponse;
}

export function fixtureMode(): boolean {
  return process.env.HOLMES_FIXTURE === "1";
}

const FIXTURE_STEP_DELAY_MS = 350;

async function* fixtureStream(abort?: AbortSignal): AsyncGenerator<DrillEvent> {
  const file = path.join(process.cwd(), "fixtures", "holmes-response.json");
  const response = JSON.parse(
    await fs.readFile(file, "utf-8"),
  ) as HolmesChatResponse;
  const started = Date.now();

  yield { type: "ai_message", content: "Planning the investigation…" };
  for (const call of response.tool_calls) {
    yield {
      type: "tool_start",
      id: call.tool_call_id,
      tool_name: call.tool_name,
    };
    await new Promise((r) => setTimeout(r, FIXTURE_STEP_DELAY_MS));
    // Same contract as the live path: an abort surfaces as the caller's reason,
    // so Stop and a worker shutdown can be exercised without spending a run.
    if (abort?.aborted) throw abort.reason;
    yield { type: "tool_result", toolCall: call };
  }
  const { conversation_history: _history, ...clientResponse } = response;
  yield {
    type: "done",
    response: clientResponse,
    drill_duration_ms: Date.now() - started,
  };
}

/**
 * Live Holmes SSE → DrillEvents. Event payloads per
 * https://holmesgpt.dev/latest/reference/http-api/ — tool calls are
 * accumulated so the persisted response carries the full tool_calls array
 * (ai_answer_end does not include it).
 *
 * Frontend tools: when Holmes pauses with `approval_required` carrying
 * `pending_frontend_tool_calls`, Drill executes the knowledge search
 * server-side, emits it as a regular tool_start/tool_result pair (so the
 * timeline and persistence need no special casing), and resumes with a new
 * POST carrying `frontend_tool_results` + Holmes's paused history.
 *
 * Tool approvals: a pause that also carries `pending_approvals` ends the
 * stream with a `done` whose response has them set. That response (with the
 * paused history) is persisted; the user's decision comes back as a new
 * /api/chat request with `tool_decisions`, which resumes from it.
 */
async function* liveStream(
  req: HolmesChatRequest,
  outcome: StreamOutcome,
  agent: AgentTarget,
  abort?: AbortSignal,
): AsyncGenerator<DrillEvent> {
  const started = Date.now();
  const toolCalls: ToolCall[] = [];
  let body: HolmesChatRequest = req;

  for (let round = 0; round <= MAX_FRONTEND_TOOL_ROUNDS; round++) {
    const { events, progress } = await openHolmesStream(
      agent,
      body,
      INVESTIGATION_TIMEOUT_MS,
      abort,
    );

    let resume: {
      history: ConversationMessage[];
      results: FrontendToolResult[];
    } | null = null;

    for await (const ev of events) {
      switch (ev.event) {
        case "start_tool_calling":
          yield { type: "tool_start", id: ev.id, tool_name: ev.toolName };
          break;
        case "tool_calling_result":
          toolCalls.push(ev.toolCall);
          yield { type: "tool_result", toolCall: ev.toolCall };
          break;
        case "ai_message":
          yield { type: "ai_message", content: ev.content };
          break;
        case "ai_answer_end": {
          const response = answerFromPayload(ev.payload, toolCalls);
          outcome.response = response;
          const { conversation_history: _history, ...clientResponse } =
            response;
          yield {
            type: "done",
            response: clientResponse,
            drill_duration_ms: Date.now() - started,
          };
          return;
        }
        case "approval_required": {
          const payload = ev.payload;
          const pending = (payload.pending_frontend_tool_calls ??
            []) as PendingFrontendToolCall[];
          const approvals = (payload.pending_approvals ??
            []) as PendingToolApproval[];
          if (pending.length === 0 && approvals.length === 0) {
            throw new Error("Holmes paused with nothing pending");
          }
          const results: FrontendToolResult[] = [];
          for (const call of pending) {
            const id = String(call.tool_call_id ?? "");
            const name = String(call.tool_name ?? "");
            yield { type: "tool_start", id, tool_name: name };
            const resultData =
              name === SEARCH_TOOL_NAME
                ? await runSearchTool(call.arguments)
                : JSON.stringify({ error: `unknown frontend tool: ${name}` });
            const toolCall: ToolCall = {
              tool_call_id: id,
              tool_name: name,
              toolset_name: "drill-knowledge",
              description: `${name}(${
                typeof call.arguments === "string"
                  ? call.arguments
                  : JSON.stringify(call.arguments ?? {})
              })`,
              result: { status: "success", error: null, data: resultData },
            };
            toolCalls.push(toolCall);
            yield { type: "tool_result", toolCall };
            results.push({ tool_call_id: id, tool_name: name, result: resultData });
          }
          if (approvals.length > 0) {
            const response: HolmesChatResponse = {
              analysis: "",
              conversation_history: (payload.conversation_history ??
                []) as ConversationMessage[],
              tool_calls: toolCalls,
              follow_up_actions: null,
              pending_approvals: approvals,
              ...(results.length && { drill_frontend_tool_results: results }),
            };
            outcome.response = response;
            const {
              conversation_history: _history,
              drill_frontend_tool_results: _results,
              ...clientResponse
            } = response;
            yield {
              type: "done",
              response: clientResponse,
              drill_duration_ms: Date.now() - started,
            };
            return;
          }
          resume = {
            history: (payload.conversation_history ??
              []) as ConversationMessage[],
            results,
          };
          break;
        }
      }
      // Holmes ends the stream after approval_required — stop reading now.
      if (resume) break;
    }

    if (!resume)
      throw connectionLost(progress, "stream closed without a final answer");
    body = {
      ...req, // keeps ask, model, frontend_tools, additional_system_prompt
      tool_decisions: undefined, // already redeemed in the previous round
      conversation_history: resume.history, // Holmes's own paused state
      frontend_tool_results: resume.results,
    };
  }
  throw new Error(
    `Investigation exceeded ${MAX_FRONTEND_TOOL_ROUNDS} knowledge-search rounds`,
  );
}

/**
 * `abort` stops the investigation early (Stop, a worker shutting down); the
 * stream then throws the signal's own reason, as `openHolmesStream` does.
 */
export async function* streamHolmes(
  req: HolmesChatRequest,
  outcome: StreamOutcome,
  agent: AgentTarget,
  abort?: AbortSignal,
): AsyncGenerator<DrillEvent> {
  if (fixtureMode()) {
    for await (const ev of fixtureStream(abort)) {
      if (ev.type === "done") {
        // Re-read for the full history copy used in persistence.
        const file = path.join(
          process.cwd(),
          "fixtures",
          "holmes-response.json",
        );
        outcome.response = JSON.parse(await fs.readFile(file, "utf-8"));
      }
      yield ev;
    }
    return;
  }
  yield* liveStream(req, outcome, agent, abort);
}
