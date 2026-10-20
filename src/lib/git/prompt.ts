import "server-only";
import { listRepositories } from "@/lib/db/git-queries";
import { gitModuleEnabled } from "./gateway";

/** Names past this are left to list_repositories — the prompt is paid for on every turn. */
const LISTED_REPOS = 30;

/**
 * Tells the agent which repositories are indexed for its org, so a question about
 * "billing-api" goes straight to code_search instead of a discovery call first.
 * Guidance only: what the agent can actually reach is decided by the gateway from
 * the request's signed scope, never by this text.
 */
export async function codeRepositoriesBlock(orgId: string): Promise<string | null> {
  if (!gitModuleEnabled()) return null;
  const repos = (await listRepositories(orgId)).filter((r) => r.branches.some((b) => b.lastSha));
  if (!repos.length) return null;
  const listed = repos
    .slice(0, LISTED_REPOS)
    .map((r) => {
      const branches = r.branches.filter((b) => b.lastSha).map((b) => b.name);
      return `${r.name} (${branches.join(", ")})`;
    })
    .join(", ");
  const more = repos.length > LISTED_REPOS ? `, and ${repos.length - LISTED_REPOS} more — see list_repositories` : "";
  return `## Code repositories
This organization's source code is pre-indexed for structural search. Indexed repositories (branches): ${listed}${more}.
For questions about code, use code_explore / code_search / code_callers / code_impact first, read_file for configuration files, and git_log / git_show for what changed recently.`;
}
