import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { getAgent } from "@/lib/db/queries";
import { usableSkills } from "@/lib/db/skill-queries";
import { fixtureMode } from "@/lib/holmes/stream";
import { servedModels } from "@/lib/holmes/validate";
import { draftSkill } from "@/lib/skills/draft";
import { validateSkillDraft, type SkillDraft } from "@/lib/skills/types";

// A real Holmes call that may confirm a name or two with tools — allow the time.
export const maxDuration = 300;

const REQUEST_LIMIT = 4000;

/**
 * POST /api/skills/draft — body: { request, agent_id, current? }. Asks the user's
 * Holmes agent to write (or, with `current`, revise) a skill and returns the
 * draft. Nothing is saved: the editor shows it for review.
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: { request?: unknown; agent_id?: unknown; current?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ask = typeof body.request === "string" ? body.request.trim() : "";
  if (!ask) return Response.json({ error: "Describe the skill you want" }, { status: 400 });
  if (ask.length > REQUEST_LIMIT)
    return Response.json({ error: `Keep the description under ${REQUEST_LIMIT} characters` }, { status: 400 });
  // A half-written form is still worth revising; one that does not validate is
  // simply not sent as a base.
  let current: SkillDraft | null = null;
  try {
    current = body.current ? validateSkillDraft(body.current) : null;
  } catch {
    current = null;
  }

  if (fixtureMode()) {
    return Response.json({
      draft: {
        name: "fixture-drafted-skill",
        description: `Fixture draft for: ${ask.slice(0, 200)}`,
        inputs: [{ key: "service", label: "Service", required: true }],
        body: `## Goal\n${ask}\n\n## Inputs\n- service: {{service}}\n\n## Workflow (follow in order)\n1. **Check pod logs** (\`kubernetes/logs\`) for {{service}}.\n2. **Check metrics** (\`prometheus/metrics\`) for its error rate.\n\n## Synthesize findings\nState the root cause with evidence.\n\n## Recommended remediation\nPer outcome.`,
      } satisfies SkillDraft,
    });
  }

  const agent =
    typeof body.agent_id === "string" ? await getAgent(user.id, body.agent_id) : null;
  if (!agent) {
    return Response.json(
      { error: "Choose a Holmes agent — add one from the chat sidebar if you have none" },
      { status: 400 },
    );
  }
  try {
    const [model] = await servedModels(agent.url, agent.apiKey);
    // The skill being revised is not a clash — listing it would push a rename.
    const existing = (await usableSkills(user.id))
      .filter((s) => s.name !== current?.name)
      .map((s) => ({ name: s.name, description: s.description }));
    const draft = await draftSkill(
      { url: agent.url, apiKey: agent.apiKey },
      model,
      { request: ask, current, existing },
      request.signal,
    );
    return Response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "drafting failed";
    return Response.json(
      { error: `Holmes could not draft the skill: ${message}` },
      { status: 502 },
    );
  }
}
