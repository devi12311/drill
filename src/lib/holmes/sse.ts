import "server-only";
import { Agent, fetch } from "undici";
import type {
  HolmesChatRequest,
  HolmesChatResponse,
  ToolCall,
} from "./types";

/**
 * The one way Drill talks to Holmes's streaming `/api/chat`: transport, SSE framing,
 * event normalisation and error wording. Chat (`stream.ts`) and monitoring
 * (`monitoring/assess.ts`) both consume it, so a Holmes contract change or a new
 * failure mode is handled once.
 */

/**
 * undici's OWN fetch + dispatcher, not the global fetch.
 *
 * Holmes sends nothing while a single LLM turn is in flight — no heartbeat exists
 * upstream — and the final structured answer of a deep run is one such turn of a
 * minute or more. Node's fetch aborts after 300s without a body chunk
 * (`bodyTimeout`), which would be the next ceiling once no proxy cuts the stream
 * at 60s. Our callers already bound each call with their own AbortSignal deadline,
 * so the transport's idle limits only need to stay out of the way.
 *
 * The npm undici is used for fetch too because a dispatcher from npm undici 7 is
 * not reliably accepted by the undici 6 bundled inside Node 22's global fetch.
 */
const IDLE_LIMIT_MS = 20 * 60 * 1000;
const dispatcher = new Agent({
  headersTimeout: IDLE_LIMIT_MS,
  bodyTimeout: IDLE_LIMIT_MS,
  connect: { timeout: 10_000 },
});

/** Connection details from the user's holmes_agents row (or a monitoring cluster). */
export interface AgentTarget {
  url: string;
  apiKey: string;
}

/** Normalised Holmes SSE events. Unknown event types (token_count, compaction) are skipped. */
export type HolmesEvent =
  | { event: "start_tool_calling"; id: string; toolName: string }
  | { event: "tool_calling_result"; toolCall: ToolCall }
  | { event: "ai_message"; content: string }
  | { event: "ai_answer_end"; payload: Record<string, unknown> }
  | { event: "approval_required"; payload: Record<string, unknown> };

/**
 * Live progress of one stream, readable by the caller at any moment — which is
 * what turns a bare `terminated` into a diagnosis when the connection drops.
 */
export interface StreamProgress {
  startedAt: number;
  lastEventAt: number;
  toolCalls: number;
}

export interface HolmesStream {
  events: AsyncGenerator<HolmesEvent>;
  progress: StreamProgress;
}

/** Holmes reported the failure itself (SSE `error` event) — not a transport problem. */
class HolmesReportedError extends Error {}

/**
 * Drill lost Holmes rather than Holmes failing: unreachable, dropped mid-stream, or
 * past the deadline. Its own class because a chat turn resumes these on its own
 * (lib/chat/runner.ts) and must not have to recognise them by their wording.
 */
export class HolmesConnectionError extends Error {}

/** Minimal SSE parser: yields {event, data} per frame. Comment lines are ignored. */
async function* parseSse(
  body: AsyncIterable<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
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
 * Holmes's `error` event carries `description` / `msg` / `error_code`
 * (docs/reference/http-api.md §error). The description is where the provider's
 * real complaint lives, e.g. the OpenRouter/Google 400 body.
 */
function holmesErrorMessage(payload: Record<string, unknown>): string {
  const text =
    payload.description ?? payload.msg ?? payload.message ?? payload.error;
  const code = payload.error_code;
  return `Holmes error${code != null ? ` ${String(code)}` : ""}: ${
    text != null ? String(text) : "no detail given"
  }`;
}

function causeOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/**
 * A stream that stopped without its terminal event. Worded for the run page, where
 * the question is always "did Holmes fail, or did we stop listening?".
 */
export function connectionLost(progress: StreamProgress, cause: string): Error {
  const idle = Date.now() - progress.lastEventAt;
  // Every drop observed on the ingress path landed 59–60s after the last event:
  // APISIX's default upstream read timeout. Naming it saves the next person the
  // log correlation.
  const proxyHint =
    idle >= 55_000 && idle <= 70_000
      ? " A drop about 60s after the last event is a proxy idle timeout — reach Holmes by its in-cluster Service URL or raise the ingress read timeout."
      : "";
  return new HolmesConnectionError(
    `Connection to Holmes dropped ${seconds(idle)} after its last event, ${progress.toolCalls} tool calls and ${seconds(
      Date.now() - progress.startedAt,
    )} in (${cause}). Holmes may still be running this investigation.${proxyHint}`,
  );
}

async function* readEvents(
  body: AsyncIterable<Uint8Array>,
  progress: StreamProgress,
  signal: AbortSignal,
): AsyncGenerator<HolmesEvent> {
  try {
    for await (const { event, data } of parseSse(body)) {
      progress.lastEventAt = Date.now();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      switch (event) {
        case "start_tool_calling":
          yield {
            event,
            id: String(payload.id ?? ""),
            toolName: String(payload.tool_name ?? "tool"),
          };
          break;
        case "tool_calling_result":
          progress.toolCalls++;
          yield { event, toolCall: toolCallFromPayload(payload) };
          break;
        case "ai_message":
          if (typeof payload.content === "string" && payload.content.trim())
            yield { event, content: payload.content };
          break;
        case "ai_answer_end":
        case "approval_required":
          yield { event, payload };
          break;
        case "error":
          throw new HolmesReportedError(holmesErrorMessage(payload));
      }
    }
  } catch (err) {
    if (err instanceof HolmesReportedError) throw err;
    if (signal.aborted && callerAborted(signal)) throw signal.reason;
    if (signal.aborted)
      throw new HolmesConnectionError(
        `Holmes did not finish within the ${seconds(
          Date.now() - progress.startedAt,
        )} deadline (${progress.toolCalls} tool calls in)`,
      );
    throw connectionLost(progress, causeOf(err));
  }
}

/**
 * True when the abort came from the caller's own signal rather than the deadline —
 * `AbortSignal.timeout` always aborts with a `TimeoutError`. The caller's reason is
 * rethrown untouched so it can tell "I cancelled this" from "Holmes went quiet".
 */
function callerAborted(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason;
  return !(reason instanceof DOMException && reason.name === "TimeoutError");
}

/**
 * POST a streaming chat request. Resolves once Holmes has sent its headers; the
 * investigation itself arrives through `events`.
 *
 * `abort` lets the caller stop an investigation early (a cancelled monitoring run,
 * a worker shutting down). It is combined with the deadline, never a replacement.
 */
export async function openHolmesStream(
  agent: AgentTarget,
  request: HolmesChatRequest,
  deadlineMs: number,
  abort?: AbortSignal,
): Promise<HolmesStream> {
  const base = agent.url.replace(/\/$/, "");
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = abort ? AbortSignal.any([deadline, abort]) : deadline;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${agent.apiKey}`,
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal,
      dispatcher,
    });
  } catch (err) {
    if (signal.aborted && callerAborted(signal)) throw signal.reason;
    throw new HolmesConnectionError(
      `Could not reach Holmes at ${base}: ${causeOf(err)}`,
    );
  }
  if (!res.ok || !res.body) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Holmes API ${res.status}: ${errBody.slice(0, 500)}`);
  }
  const now = Date.now();
  const progress: StreamProgress = { startedAt: now, lastEventAt: now, toolCalls: 0 };
  return { events: readEvents(res.body, progress, signal), progress };
}

export function toolCallFromPayload(payload: Record<string, unknown>): ToolCall {
  return {
    tool_call_id: String(payload.tool_call_id ?? ""),
    tool_name: String(payload.name ?? payload.tool_name ?? "tool"),
    description: String(payload.description ?? ""),
    result: (payload.result ?? {
      status: "success",
      error: null,
      data: null,
    }) as ToolCall["result"],
  };
}

/**
 * `ai_answer_end` → the response shape Drill persists. `tool_calls` comes from the
 * caller because the event does not carry them — they are accumulated from
 * `tool_calling_result` as the stream goes.
 */
export function answerFromPayload(
  payload: Record<string, unknown>,
  toolCalls: ToolCall[],
): HolmesChatResponse {
  return {
    analysis: String(payload.analysis ?? ""),
    conversation_history: (payload.conversation_history ??
      []) as HolmesChatResponse["conversation_history"],
    tool_calls: toolCalls,
    follow_up_actions: (payload.follow_up_actions ??
      null) as HolmesChatResponse["follow_up_actions"],
    pending_approvals: (payload.pending_approvals ??
      null) as HolmesChatResponse["pending_approvals"],
    metadata: payload.metadata as HolmesChatResponse["metadata"],
  };
}

/**
 * Run one request to its final answer, for callers that need the result rather
 * than the live events (monitoring, artifact distillation). Streaming anyway is
 * the point: a `stream: false` call is silent until Holmes finishes, and every
 * proxy and HTTP client on the way treats a long silence as a dead connection.
 *
 * Tool calls are pushed into `toolCalls` AS THEY ARRIVE, so the caller still has
 * them when the stream drops mid-investigation.
 */
export async function completeHolmesChat(
  agent: AgentTarget,
  request: HolmesChatRequest,
  deadlineMs: number,
  toolCalls: ToolCall[] = [],
  abort?: AbortSignal,
): Promise<HolmesChatResponse> {
  const { events, progress } = await openHolmesStream(
    agent,
    request,
    deadlineMs,
    abort,
  );
  const own: ToolCall[] = [];
  for await (const ev of events) {
    if (ev.event === "tool_calling_result") {
      own.push(ev.toolCall);
      toolCalls.push(ev.toolCall);
    } else if (ev.event === "ai_answer_end") {
      return answerFromPayload(ev.payload, own);
    }
  }
  throw connectionLost(progress, "stream closed without a final answer");
}
