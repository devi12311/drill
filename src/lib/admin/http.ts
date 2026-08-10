import "server-only";
import { resolveRange } from "@/lib/db/admin-queries";

/** Parse the range query params (?range=&from=&to=) from a request URL. */
export function rangeFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  return resolveRange({
    range: searchParams.get("range"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });
}
