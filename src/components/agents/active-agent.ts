/**
 * The agent the user last chose in the chat sidebar, remembered per browser. The
 * chat page writes it; other pages that call Holmes (the skill drafter) default
 * to the same agent instead of asking again.
 */
export const AGENT_STORAGE_KEY = "drill.activeAgentId";

/** The stored choice if it is still one of `agents`, else the first agent. */
export function pickActiveAgent<A extends { id: string }>(
  agents: readonly A[],
  current: string | null = null,
): string | null {
  const stored = current ?? localStorage.getItem(AGENT_STORAGE_KEY);
  if (stored && agents.some((a) => a.id === stored)) return stored;
  return agents[0]?.id ?? null;
}
