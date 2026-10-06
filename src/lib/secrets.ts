import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Credentials at rest (docs/DECISIONS.md 129): Holmes API keys and kubeconfigs are
 * replayed verbatim to other systems, so they cannot be hashed — they are sealed
 * with AES-256-GCM under `DRILL_ENCRYPTION_KEY` (32 bytes, base64) and opened only
 * in the query functions that hand them to a caller.
 *
 * Stored form: `enc:v1:<iv>.<tag>.<ciphertext>` (base64url). The version leaves room
 * for key rotation; a value WITHOUT the prefix is a legacy plaintext row, still
 * readable, and re-sealed by `sealLegacySecrets` at start-up.
 *
 * No key: production refuses to start (`assertEncryptionReady`); development keeps
 * plaintext with a warning, so a local setup works without one.
 */

const PREFIX = "enc:v1:";

let cached: Buffer | null | undefined;

function key(): Buffer | null {
  if (cached !== undefined) return cached;
  const raw = process.env.DRILL_ENCRYPTION_KEY?.trim();
  if (!raw) return (cached = null);
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32)
    throw new Error(
      "DRILL_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)",
    );
  return (cached = decoded);
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Seal a credential for storage. Without a key (dev only) it is stored as is. */
export function sealSecret(plain: string): string {
  const k = key();
  if (!k || isSealed(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${[iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".")}`;
}

/** Open a stored credential; a legacy plaintext value passes through. */
export function openSecret(stored: string): string {
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k)
    throw new Error(
      "A stored credential is encrypted but DRILL_ENCRYPTION_KEY is not set",
    );
  const [iv, tag, body] = stored
    .slice(PREFIX.length)
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * Called once at start-up. Throws in production without a usable key — a SaaS
 * must never quietly store tenants' credentials in plaintext — and only warns in
 * development.
 */
export function assertEncryptionReady(): void {
  if (key()) return;
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "DRILL_ENCRYPTION_KEY is required in production (openssl rand -base64 32)",
    );
  console.warn(
    "[drill] DRILL_ENCRYPTION_KEY is not set — credentials are stored in plaintext (development only)",
  );
}

/** Whether new writes are being sealed — the start-up backfill runs only then. */
export function encryptionEnabled(): boolean {
  return key() !== null;
}
