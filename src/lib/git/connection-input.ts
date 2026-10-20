import "server-only";
import { unprocessable } from "./access";
import { isAccountName, type GitProvider } from "./types";

export interface ConnectionBody {
  provider?: string;
  name?: string;
  account?: string;
  username?: string | null;
  token?: string;
}

/** Shared by create and edit: the normalized fields, or the 4xx to send. */
export function parseConnection(
  body: ConnectionBody,
  provider: GitProvider,
): { name: string; account: string; username: string | null } | Response {
  const name = body.name?.trim() ?? "";
  const account = body.account?.trim() ?? "";
  // Only Bitbucket has two token kinds; an email there means "Atlassian API token".
  const username = provider === "bitbucket" ? body.username?.trim() || null : null;
  if (!name || name.length > 80) return unprocessable("A name of up to 80 characters is required", "name");
  if (!isAccountName(account)) return unprocessable("Enter the owner / workspace slug, e.g. paperclicks", "account");
  if (username && !/^[^@\s]+@[^@\s]+$/.test(username)) return unprocessable("Enter the Atlassian account email", "username");
  return { name, account, username };
}
