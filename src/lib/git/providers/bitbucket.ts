import "server-only";
import type { RemoteRepo } from "@/lib/git/types";
import { branchPath, providerExists, providerFetch, type ConnectionCredentials, type GitProviderClient } from "./types";

const API = "https://api.bitbucket.org/2.0";
const PAGE = 50;

interface BbRepo {
  uuid: string;
  full_name: string;
  slug: string;
  is_private: boolean;
  updated_on: string | null;
  mainbranch?: { name: string } | null;
}

/**
 * Two token kinds, told apart by whether an email is set:
 *  - workspace / repository access token → REST `Bearer`, git user `x-token-auth`;
 *  - Atlassian API token (email + token) → REST Basic, git user
 *    `x-bitbucket-api-token-auth` (Atlassian: "Using API tokens").
 * Either needs repository read scope.
 */
const authHeader = (c: ConnectionCredentials) =>
  c.username
    ? `Basic ${Buffer.from(`${c.username}:${c.token}`).toString("base64")}`
    : `Bearer ${c.token}`;

const get = (c: ConnectionCredentials, path: string) =>
  providerFetch(`${API}${path}`, { headers: { Authorization: authHeader(c), Accept: "application/json" } }, "Bitbucket");

const ws = (c: ConnectionCredentials) => encodeURIComponent(c.account);

/** BBQL string literal: the query is user input inside a quoted filter. */
const bbql = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

const toRemote = (r: BbRepo): RemoteRepo => ({
  externalId: r.uuid,
  fullName: r.full_name,
  name: r.slug,
  defaultBranch: r.mainbranch?.name ?? "main",
  private: r.is_private,
  updatedAt: r.updated_on,
});

export const bitbucket: GitProviderClient = {
  async validate(c) {
    await get(c, `/repositories/${ws(c)}?pagelen=1`);
  },

  async listRepos(c, { query, page }) {
    const q = query?.trim() ? `&q=${encodeURIComponent(`name ~ ${bbql(query.trim())}`)}` : "";
    const data = (await get(c, `/repositories/${ws(c)}?pagelen=${PAGE}&page=${page}&sort=-updated_on${q}`)) as {
      values: BbRepo[];
      next?: string;
    };
    return { repos: data.values.map(toRemote), hasMore: !!data.next };
  },

  async getRepo(c, fullName) {
    const r = (await get(c, `/repositories/${fullName}`)) as BbRepo;
    // Built, not taken from `links.clone`: that URL embeds a username, and the
    // gateway only accepts credential-free remotes.
    return { ...toRemote(r), cloneUrl: `https://bitbucket.org/${r.full_name}.git` };
  },

  async listBranches(c, fullName, query) {
    const q = query?.trim() ? `&q=${encodeURIComponent(`name ~ ${bbql(query.trim())}`)}` : "";
    const data = (await get(c, `/repositories/${fullName}/refs/branches?pagelen=100&sort=-target.date${q}`)) as {
      values: { name: string }[];
    };
    return data.values.map((b) => b.name);
  },

  hasBranch: (c, fullName, branch) =>
    providerExists(
      `${API}/repositories/${fullName}/refs/branches/${branchPath(branch)}`,
      { headers: { Authorization: authHeader(c), Accept: "application/json" } },
      "Bitbucket",
    ),

  cloneAuth: (c) => ({
    username: c.username ? "x-bitbucket-api-token-auth" : "x-token-auth",
    password: c.token,
  }),
};
