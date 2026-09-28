import "server-only";
import { fixtureMode } from "./stream";

/**
 * Validate a Holmes agent by listing its models.
 * Throws with a user-facing message on any failure.
 * Note: deployed Holmes 0.35.0 returns model_name as a JSON-encoded string.
 */
export async function validateAgent(
  url: string,
  apiKey: string,
): Promise<string[]> {
  const base = url.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/model`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach Holmes at ${base}: ${detail}`);
  }
  if (res.status === 401) {
    throw new Error("Holmes rejected the API key (401 Unauthorized)");
  }
  if (!res.ok) {
    throw new Error(`Holmes returned HTTP ${res.status} from /api/model`);
  }
  let body: { model_name?: string[] | string };
  try {
    body = await res.json();
  } catch {
    throw new Error("Holmes /api/model did not return JSON — wrong URL?");
  }
  const models =
    typeof body.model_name === "string"
      ? (JSON.parse(body.model_name) as string[])
      : body.model_name;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("Holmes /api/model returned no models — wrong URL?");
  }
  return models;
}

/**
 * What an agent serves right now, in its own order — the first entry is the
 * default. Drill deliberately keeps no model list or default of its own: a
 * hardcoded name outlives the agent's `modelList` (an entry gets deprecated
 * and the stale name keeps being offered and sent).
 *
 * Fixture mode never calls the agent for chats, so an unreachable agent must
 * not block UI work there.
 */
export async function servedModels(
  url: string,
  apiKey: string,
): Promise<string[]> {
  try {
    return await validateAgent(url, apiKey);
  } catch (err) {
    if (fixtureMode()) return ["fixture"];
    throw err;
  }
}
