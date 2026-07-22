/**
 * Types for the HolmesGPT HTTP API (POST /api/chat).
 * Contract: https://holmesgpt.dev/latest/reference/http-api/
 * Real example payload: fixtures/holmes-response.json
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
  pending_approvals: unknown;
  metadata?: HolmesMetadata;
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
}

/** Todo item embedded in TodoWrite tool-call params. */
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export const DEFAULT_MODEL = "gpt-5-mini";

/** Fallback list; the UI should prefer GET /api/models (proxying Holmes /api/model). */
export const KNOWN_MODELS = [
  "gpt-5-mini",
  "gpt-5.4",
  "gpt-5",
  "gpt-4.1",
  "gemini-pro",
  "gemini-flash",
];
