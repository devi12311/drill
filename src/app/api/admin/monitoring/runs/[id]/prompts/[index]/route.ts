import { forbidden, getAdminActor } from "@/lib/auth/session";
import { getRunPrompt } from "@/lib/db/monitoring-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string; index: string }> };

/**
 * One verbatim prompt from a run, by position.
 *
 * The run page used to receive every prompt with its payload and render all of
 * them into the DOM behind closed `<details>` elements. This is what those
 * elements ask for when they are actually opened.
 */
export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id, index } = await context.params;
  const position = Number(index);
  if (!Number.isInteger(position) || position < 0)
    return Response.json({ error: "Not found" }, { status: 404 });
  const prompt = await getRunPrompt(id, position);
  if (prompt === null)
    return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ prompt });
}
