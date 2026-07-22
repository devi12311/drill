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
  ToolCall,
} from "./types";

const INVESTIGATION_TIMEOUT_MS = 15 * 60 * 1000;
/** Backstop against Holmes calling the knowledge tool in a loop. */
const MAX_FRONTEND_TOOL_ROUNDS = 4;

/**
 * Drill's normalized stream events. The client only ever sees these;
 * Holmes SSE (or the fixture simulator) is mapped into them server-side.
 * `done.response` has conversation_history stripped — it stays server-side.
 */
export type DrillEvent =
  | { type: "tool_start"; id: string; tool_name: string }
  | { type: "tool_result"; toolCall: ToolCall }
  | { type: "ai_message"; content: string }
  | {
      type: "done";
      response: Omit<HolmesChatResponse, "conversation_history">;
      drill_duration_ms: number;
    }
  | { type: "error"; message: string };

/** Full response including history — for persistence, never sent to the client. */
export interface StreamOutcome {
  response: HolmesChatResponse;
}

/** Connection details from the user's holmes_agents row. */
export interface AgentTarget {
  url: string;
  apiKey: string;
}

export function fixtureMode(): boolean {
  return process.env.HOLMES_FIXTURE === "1";
}

const FIXTURE_STEP_DELAY_MS = 350;

async function* fixtureStream(): AsyncGenerator<DrillEvent> {
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
    yield { type: "tool_result", toolCall: call };
  }
  const { conversation_history: _history, ...clientResponse } = response;
  yield {
    type: "done",
    response: clientResponse,
    drill_duration_ms: Date.now() - started,
  };
}

/** Minimal SSE parser: yields {event, data} per frame. */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) yield { event, data: dataLines.join("\n") };
    }
  }
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
 */
async function* liveStream(
  req: HolmesChatRequest,
  outcome: StreamOutcome,
  agent: AgentTarget,
): AsyncGenerator<DrillEvent> {
  const base = agent.url.replace(/\/$/, "");
  const started = Date.now();
  const toolCalls: ToolCall[] = [];
  let body: HolmesChatRequest = { ...req, stream: true };

  for (let round = 0; round <= MAX_FRONTEND_TOOL_ROUNDS; round++) {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${agent.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INVESTIGATION_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Holmes API ${res.status}: ${errBody.slice(0, 500)}`);
    }

    let resume: {
      history: ConversationMessage[];
      results: FrontendToolResult[];
    } | null = null;

    for await (const { event, data } of parseSse(res.body)) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      switch (event) {
        case "start_tool_calling": {
          yield {
            type: "tool_start",
            id: String(payload.id ?? ""),
            tool_name: String(payload.tool_name ?? "tool"),
          };
          break;
        }
        case "tool_calling_result": {
          const toolCall: ToolCall = {
            tool_call_id: String(payload.tool_call_id ?? ""),
            tool_name: String(payload.name ?? payload.tool_name ?? "tool"),
            description: String(payload.description ?? ""),
            result: (payload.result ?? {
              status: "success",
              error: null,
              data: null,
            }) as ToolCall["result"],
          };
          toolCalls.push(toolCall);
          yield { type: "tool_result", toolCall };
          break;
        }
        case "ai_message": {
          const content = payload.content;
          if (typeof content === "string" && content.trim())
            yield { type: "ai_message", content };
          break;
        }
        case "ai_answer_end": {
          const response: HolmesChatResponse = {
            analysis: String(payload.analysis ?? ""),
            conversation_history: (payload.conversation_history ??
              []) as HolmesChatResponse["conversation_history"],
            tool_calls: toolCalls,
            follow_up_actions: (payload.follow_up_actions ??
              null) as HolmesChatResponse["follow_up_actions"],
            pending_approvals: payload.pending_approvals ?? null,
            metadata: payload.metadata as HolmesChatResponse["metadata"],
          };
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
          const pending = payload.pending_frontend_tool_calls as
            | PendingFrontendToolCall[]
            | undefined;
          if (!Array.isArray(pending) || pending.length === 0) {
            // Backend tool approvals are disabled in this deployment; a
            // pause without frontend calls is unrecoverable for Drill.
            throw new Error(
              "Holmes paused for tool approval — approvals are not supported by Drill",
            );
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
          resume = {
            history: (payload.conversation_history ??
              []) as ConversationMessage[],
            results,
          };
          break;
        }
        case "error": {
          const message = String(
            payload.description ?? payload.msg ?? "Holmes stream error",
          );
          throw new Error(message);
        }
        // token_count, compaction events: not surfaced yet
      }
      // Holmes ends the stream after approval_required — stop reading now.
      if (resume) break;
    }

    if (!resume) throw new Error("Holmes stream ended without ai_answer_end");
    body = {
      ...req, // keeps ask, model, frontend_tools, additional_system_prompt
      stream: true,
      conversation_history: resume.history, // Holmes's own paused state
      frontend_tool_results: resume.results,
    };
  }
  throw new Error(
    `Investigation exceeded ${MAX_FRONTEND_TOOL_ROUNDS} knowledge-search rounds`,
  );
}

export async function* streamHolmes(
  req: HolmesChatRequest,
  outcome: StreamOutcome,
  agent: AgentTarget,
): AsyncGenerator<DrillEvent> {
  if (fixtureMode()) {
    for await (const ev of fixtureStream()) {
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
  yield* liveStream(req, outcome, agent);
}
