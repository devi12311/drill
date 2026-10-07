import "server-only";
import { runSearchTool, SEARCH_TOOL_DEF } from "@/lib/artifacts/search";
import { FETCH_SKILL_TOOL_DEF, runFetchSkill } from "@/lib/skills/tool";
import type { Scope } from "@/lib/db/queries";
import type { FrontendToolDef, ToolCall } from "./types";

/**
 * Drill's own tools offered to Holmes as pause-mode frontend tools: Holmes stops,
 * Drill runs the tool server-side, and the stream resumes with the result
 * (lib/holmes/stream.ts). One registry, so the stream loop never names a tool.
 */

/** Who the investigation runs for — a tool may only show them what they may see. */
export type FrontendToolContext = Scope;

export interface FrontendToolOutcome {
  /** Handed back to Holmes verbatim; Holmes requires a string. */
  data: string;
  /** "error" when the call could not do what it was asked (unknown skill…). */
  status: "success" | "error";
}

interface FrontendTool {
  def: FrontendToolDef;
  /** The timeline's toolset label — "drill-…", which `isDrillTool` relies on. */
  toolset: string;
  /** Never throws: a broken Drill feature must not kill a live investigation. */
  run(args: Record<string, unknown>, ctx: FrontendToolContext): Promise<FrontendToolOutcome>;
}

const TOOLS: readonly FrontendTool[] = [
  {
    def: SEARCH_TOOL_DEF,
    toolset: "drill-knowledge",
    run: async (args, ctx) => ({
      data: await runSearchTool(args, ctx.orgId),
      status: "success",
    }),
  },
  { def: FETCH_SKILL_TOOL_DEF, toolset: "drill-skills", run: runFetchSkill },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.def.name, tool]));

/** The tool definitions sent with every live ask. */
export const FRONTEND_TOOL_DEFS: FrontendToolDef[] = TOOLS.map((t) => t.def);

/** Holmes sends arguments as an object or a JSON string; anything else is empty. */
function parseArgs(raw: unknown): Record<string, unknown> {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Run one paused call and shape it as the timeline's ToolCall. */
export async function runFrontendTool(
  call: { id: string; name: string; arguments: unknown },
  ctx: FrontendToolContext,
): Promise<ToolCall> {
  const tool = BY_NAME.get(call.name);
  const params = parseArgs(call.arguments);
  const outcome: FrontendToolOutcome = tool
    ? await tool.run(params, ctx).catch((err: unknown) => ({
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        status: "error" as const,
      }))
    : { data: JSON.stringify({ error: `unknown frontend tool: ${call.name}` }), status: "error" };
  return {
    tool_call_id: call.id,
    tool_name: call.name,
    toolset_name: tool?.toolset ?? "drill",
    description: `${call.name}(${JSON.stringify(params)})`,
    result: {
      status: outcome.status,
      error: outcome.status === "error" ? outcome.data : null,
      data: outcome.data,
      params,
    },
  };
}
