import { getAuthContext, unauthorized } from "@/lib/auth/session";
import {
  getTurnSnapshot,
  turnEventsAfter,
} from "@/lib/db/chat-turn-queries";
import {
  isActiveTurn,
  type TurnSnapshot,
  type TurnStreamMessage,
} from "@/lib/chat/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/** How often the tail looks for new events — an indexed read on (turn_id, seq). */
const POLL_MS = 750;
/**
 * An SSE comment this often keeps the browser's stream alive through an ingress
 * that drops connections idle for its read timeout (60s by default).
 */
const PING_MS = 15_000;

/**
 * GET /api/chat/turns/[id]/events — a turn's progress as SSE, replayed from
 * storage and then followed live. Resumable: each event carries `id: <seq>`, so
 * the browser's own EventSource reconnect (Last-Event-ID) — or `?after=<seq>` —
 * continues exactly where it left off. Ends with `settled` once the turn row is
 * gone (it answered: messages hold the result) or after a `turn` frame showing
 * it stopped.
 *
 * A turn that no longer exists reads as `settled` rather than 404: by the time a
 * tab attaches, its answer may simply be in already.
 */
export async function GET(request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  const url = new URL(request.url);
  let after =
    Number(request.headers.get("last-event-id") ?? url.searchParams.get("after")) ||
    0;

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (message: TurnStreamMessage, seq?: number) =>
        write(`${seq != null ? `id: ${seq}\n` : ""}data: ${JSON.stringify(message)}\n\n`);
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);

      const drain = async () => {
        // Loop while full pages come back, so a reattach replays a long turn fast.
        for (;;) {
          const rows = await turnEventsAfter(id, after);
          for (const row of rows) {
            send(
              { type: "event", seq: row.seq, at: row.createdAt.getTime(), event: row.payload },
              row.seq,
            );
            after = row.seq;
          }
          if (rows.length < 200 || closed) return;
        }
      };

      let last: TurnSnapshot | null = null;
      try {
        while (!closed) {
          // Ownership is checked on every pass, so the events of a turn this
          // user does not own are never read (snapshot first, then events).
          const turn = await getTurnSnapshot(ctx, id);
          if (!turn) {
            send({ type: "settled" });
            break;
          }
          await drain();
          if (
            !last ||
            last.status !== turn.status ||
            last.attempt !== turn.attempt ||
            last.error !== turn.error
          ) {
            send({ type: "turn", turn, serverNow: Date.now() });
            last = turn;
          }
          if (!isActiveTurn(turn.status)) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch {
        // Database blip: end the stream; the browser reconnects from its last id.
      } finally {
        clearInterval(ping);
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed by cancellation
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
