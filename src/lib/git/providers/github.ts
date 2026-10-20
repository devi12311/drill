import "server-only";
import type { RemoteRepo } from "@/lib/git/types";
import { branchPath, providerExists, providerFetch, type ConnectionCredentials, type GitProviderClient } from "./types";

const API = "https://api.github.com";
const PAGE = 50;

interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  default_branch: string;
  private: boolean;
  pushed_at: string | null;
  owner: { login: string };
}

const headers = (c: ConnectionCredentials) => ({
  Authorization: `Bearer ${c.token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const get = (c: ConnectionCredentials, path: string) =>
  providerFetch(`${API}${path}`, { headers: headers(c) }, "GitHub");

const toRemote = (r: GhRepo): RemoteRepo => ({
  externalId: String(r.id),
  fullName: r.full_name,
  name: r.name,
  defaultBranch: r.default_branch,
  private: r.private,
  updatedAt: r.pushed_at,
});

/**
 * Fine-grained personal access token scoped to one resource owner, with
 * Contents: read and Metadata: read. Classic tokens work too (`repo` scope).
 */
export const github: GitProviderClient = {
  async validate(c) {
    await get(c, "/user");
    // The owner must exist; the search below also proves the token can see its repos.
    await get(c, `/users/${encodeURIComponent(c.account)}`);
  },

  async listRepos(c, { query, page }) {
    // The search API covers both org and user owners, private repos included, in
    // one paginated call — /user/repos would need client-side owner filtering.
    const owner = (await get(c, `/users/${encodeURIComponent(c.account)}`)) as { type: string };
    const qualifier = owner.type === "Organization" ? "org" : "user";
    const q = `${query?.trim() ? `${query.trim()} in:name ` : ""}${qualifier}:${c.account} fork:true`;
    const data = (await get(
      c,
      `/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=${PAGE}&page=${page}`,
    )) as { total_count: number; items: GhRepo[] };
    return { repos: data.items.map(toRemote), hasMore: page * PAGE < data.total_count };
  },

  async getRepo(c, fullName) {
    const r = (await get(c, `/repos/${fullName}`)) as GhRepo;
    return { ...toRemote(r), cloneUrl: `https://github.com/${r.full_name}.git` };
  },

  async listBranches(c, fullName, query) {
    const q = query?.trim();
    if (!q) {
      const rows = (await get(c, `/repos/${fullName}/branches?per_page=100`)) as { name: string }[];
      return rows.map((b) => b.name);
    }
    // GitHub has no branch search; matching-refs is a server-side PREFIX match, so a
    // repo with hundreds of branches still finds `rc` past the first page.
    const refs = (await get(c, `/repos/${fullName}/git/matching-refs/heads/${branchPath(q)}`)) as { ref: string }[];
    return refs.slice(0, 100).map((r) => r.ref.replace(/^refs\/heads\//, ""));
  },

  hasBranch: (c, fullName, branch) =>
    providerExists(`${API}/repos/${fullName}/branches/${branchPath(branch)}`, { headers: headers(c) }, "GitHub"),

  // GitHub accepts any username with a token as the password; this one is conventional.
  cloneAuth: (c) => ({ username: "x-access-token", password: c.token }),
};
