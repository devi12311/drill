import "server-only";
import { getAgent } from "@/lib/db/queries";

/**
 * The org agent a cluster is being pointed at, or the 422 to return. Shared by
 * cluster create and update so both reject a foreign or missing agent the same way.
 */
export async function findClusterAgent(orgId: string, agentId: string | undefined) {
  const agent = agentId ? await getAgent(orgId, agentId) : null;
  return (
    agent ??
    Response.json(
      { error: "Pick a Holmes agent from this organization", field: "agentId" },
      { status: 422 },
    )
  );
}

/** The agent did not answer `GET /api/model`: say which one, on the agent field. */
export function agentUnreachable(agentName: string, err: unknown): Response {
  const reason = err instanceof Error ? err.message : "Holmes validation failed";
  return Response.json(
    { error: `${agentName}: ${reason}`, field: "agentId" },
    { status: 422 },
  );
}
