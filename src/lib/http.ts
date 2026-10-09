/** A failed API call: the server's own `error` message, and its status for callers that branch on it. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * JSON request that throws the API's own `error` message on failure. Without a
 * `body` (a DELETE, say) nothing is sent, not even a Content-Type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers name the shape they expect
export async function sendJson<T = any>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  // A proxy timeout or crash has no JSON body; the status still says what happened.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(data?.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}
