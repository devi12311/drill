import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { orgWorkloadSignals } from "@/lib/db/monitoring-queries";
import {
  byPriority,
  detectTechnology,
  parseWorkloadTypeDraft,
} from "@/lib/monitoring/workload-types";
import { detectableTypes } from "@/lib/monitoring/workload-types-live";

const SAMPLE = 25;

/**
 * POST { slug, label, priority, labelValues, patterns, enabled } — what detection
 * WOULD say about this org's discovered workloads if the draft were saved: which
 * would become this type, and which would stop being it. Read-only and per org
 * (it needs the org's inventory, whichever catalogue the editor is in).
 *
 * Judged on images only: the inventory caches images, not labels or container
 * names, so label rules apply at the next rescan — the response says so.
 */
export async function POST(request: Request) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  let slug: string;
  let draft;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    slug = String(body.slug ?? "").toLowerCase();
    draft = parseWorkloadTypeDraft(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid workload type" },
      { status: 400 },
    );
  }
  const current = await detectableTypes(ctx.orgId);
  const withDraft = byPriority([
    ...current.filter((t) => t.slug !== slug),
    ...(draft.enabled ? [{ slug, ...draft }] : []),
  ]);
  const gained: { cluster: string; workload: string; was: string | null; reason: string }[] = [];
  const lost: { cluster: string; workload: string; becomes: string | null }[] = [];
  for (const w of await orgWorkloadSignals(ctx.orgId)) {
    // A hand-set technology is not detection's to change.
    if (w.technologyOverride) continue;
    const before = detectTechnology({ images: w.images }, current)?.technology ?? null;
    const after = detectTechnology({ images: w.images }, withDraft);
    const id = { cluster: w.clusterName, workload: `${w.namespace}/${w.name}` };
    if (after?.technology === slug && before !== slug)
      gained.push({ ...id, was: before, reason: after.reason });
    else if (before === slug && after?.technology !== slug)
      lost.push({ ...id, becomes: after?.technology ?? null });
  }
  return Response.json({
    gained: gained.slice(0, SAMPLE),
    gainedTotal: gained.length,
    lost: lost.slice(0, SAMPLE),
    lostTotal: lost.length,
    note: "Judged from cached images; label rules apply at the next rescan.",
  });
}
