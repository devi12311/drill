import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Link tokens — an org invitation, a share link. The link IS the credential, so
 * only the sha256 is stored: a leaked table exposes no usable link, and the raw
 * token exists once, in the response that creates it.
 */
export function newLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLinkToken(token) };
}

export const hashLinkToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
