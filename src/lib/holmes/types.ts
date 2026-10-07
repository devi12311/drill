/**
 * Types for the HolmesGPT HTTP API (POST /api/chat).
 * Contract: https://holmesgpt.dev/latest/reference/http-api/
 * Example payload (synthetic, same shape as a real capture): fixtures/holmes-response.json
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ConversationMessage {
  role: ChatRole;
  content: string | null;
  [key: string]: unknown;
}

export interface ToolCallResult {
  schema_version?: string;
  status: "success" | "error" | string;
  error: string | null;
  return_code?: number | null;
  data: string | null;
  params?: Record<string, unknown> | null;
  invocation?: string | null;
  url?: string | null;
}

export interface ToolCall {
  tool_call_id: string;
  tool_name: string;
  toolset_name?: string;
  description: string;
  size?: number;
  result: ToolCallResult;
}

/**
 * Drill's own pause-mode tools (lib/holmes/frontend-tools.ts) are labelled with a
 * "drill-…" toolset. They run on their own every turn, so they are never a step
 * someone could build a skill from.
 */
export function isDrillTool(call: Pick<ToolCall, "toolset_name">): boolean {
  const toolset = call.toolset_name ?? "";
  return toolset === "drill" || toolset.startsWith("drill-");
}

/**
 * The record of a call Holmes paused on for approval. Once decided, the same
 * `tool_call_id` comes back in the next answer with its real result.
 */
export function awaitsApproval(call: Pick<ToolCall, "result">): boolean {
  return call.result.status === "approval_required";
}

export interface FollowUpAction {
  id: string;
  action_label: string;
  pre_action_notification_text: string;
  prompt: string;
}

export interface HolmesMetadata {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
  };
  costs?: {
    total_cost?: number;
    total_tokens?: number;
  };
  finish_reason?: string;
  request_id?: string;
  [key: string]: unknown;
}

export interface HolmesChatResponse {
  analysis: string;
  conversation_history: ConversationMessage[];
  tool_calls: ToolCall[];
  follow_up_actions: FollowUpAction[] | null;
  /** Non-empty when Holmes paused for a human decision instead of answering. */
  pending_approvals: PendingToolApproval[] | null;
  /**
   * Drill-only: knowledge-search results computed in the same pause as the
   * approvals. Holmes needs them back alongside the decisions on resume.
   */
  drill_frontend_tool_results?: FrontendToolResult[];
  /**
   * Drill-only, on a pause: the question the paused investigation is answering.
   * The decision turn that resumes it carries it forward, so if that turn has to
   * be rebuilt from evidence it still knows what was asked (its own ask is "").
   */
  drill_question?: string;
  /**
   * Drill-only: set on a turn that failed or was stopped and then dismissed. Its
   * partial tool calls are kept; there is no answer and no replayable history.
   */
  drill_error?: string;
  metadata?: HolmesMetadata;
}

/** Payload item of the `approval_required` SSE event for backend tools. */
export interface PendingToolApproval {
  tool_call_id: string;
  tool_name: string;
  description: string;
  params: Record<string, unknown>;
}

/** Answer to a PendingToolApproval; `feedback` reaches Holmes only on a denial. */
export interface ToolApprovalDecision {
  tool_call_id: string;
  approved: boolean;
  feedback?: string;
}

/** Client-defined tool Holmes may call; `mode: "pause"` suspends the stream. */
export interface FrontendToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mode: "pause";
}

/** Result for a paused frontend tool call; `result` must be a string. */
export interface FrontendToolResult {
  tool_call_id: string;
  tool_name: string;
  result: string;
}

/** Payload item of the `approval_required` SSE event for frontend tools. */
export interface PendingFrontendToolCall {
  tool_call_id: string;
  tool_name: string;
  arguments?: unknown;
}

export interface HolmesChatRequest {
  ask: string;
  model?: string;
  conversation_history?: ConversationMessage[];
  stream?: boolean;
  /** Strict JSON-schema structured output; the result arrives in `analysis`. */
  response_format?: Record<string, unknown>;
  /** Appended to Holmes's system prompt (knowledge injection). */
  additional_system_prompt?: string;
  frontend_tools?: FrontendToolDef[];
  /** Resumes a stream paused by a frontend tool call. */
  frontend_tool_results?: FrontendToolResult[];
  /** Pause on tools named in a toolset's approval_required_tools. */
  enable_tool_approval?: boolean;
  /** Resumes a stream paused for approval. */
  tool_decisions?: ToolApprovalDecision[];
  /** Enable/disable individual system-prompt sections (upstream "fast mode"). */
  behavior_controls?: Record<string, boolean>;
}

/** Todo item embedded in TodoWrite tool-call params. */
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}
