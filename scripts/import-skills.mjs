// Import SKILL.md files into Drill as shared skills.
//
// Goes through Drill's own API as an admin (log in, create or update by name,
// then share) — so validation, ownership and the audit trail are exactly what
// the UI gets, with no second copy of the rules here.
//
//   DRILL_URL=http://localhost:3000 DRILL_USER=admin DRILL_PASSWORD=… \
//     node scripts/import-skills.mjs <dir-or-file>…
//
// File format: Holmes's SKILL.md (frontmatter `name`, `description`, then the
// markdown body), plus optional Drill keys, each on one line:
//   always_on: true
//   inputs: [{"key":"integration_id","label":"Integration id","required":true}]
// Re-running is safe: a skill that exists by name is updated in place.

import fs from "node:fs/promises";
import path from "node:path";

const base = (process.env.DRILL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const username = process.env.DRILL_USER;
const password = process.env.DRILL_PASSWORD;

function parseSkill(file, text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: must start with a --- frontmatter block`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return {
    name: meta.name || path.basename(path.dirname(file)),
    description: meta.description,
    body: match[2].trim(),
    inputs: meta.inputs ? JSON.parse(meta.inputs) : [],
    alwaysOn: meta.always_on === "true",
  };
}

async function skillFiles(target) {
  const stat = await fs.stat(target);
  if (stat.isFile()) return [target];
  const found = [];
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) found.push(...(await skillFiles(full)));
    else if (entry.name === "SKILL.md") found.push(full);
  }
  return found;
}

async function main() {
  const targets = process.argv.slice(2);
  if (!targets.length || !username || !password) {
    console.error("usage: DRILL_USER=… DRILL_PASSWORD=… [DRILL_URL=…] node scripts/import-skills.mjs <dir-or-file>…");
    process.exit(2);
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status} ${await login.text()}`);
  const me = await login.json();
  if (me.role !== "admin") throw new Error(`${username} is not an admin — only admins can share skills`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const api = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      body: body && JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${json?.error ?? ""}`);
    return json;
  };

  const existing = new Map((await api("GET", "/api/skills")).map((s) => [s.name, s]));
  const files = (await Promise.all(targets.map(skillFiles))).flat();
  for (const file of files) {
    const { alwaysOn, ...draft } = parseSkill(file, await fs.readFile(file, "utf-8"));
    const current = existing.get(draft.name);
    const skill = current
      ? await api("PATCH", `/api/skills/${current.id}`, draft)
      : await api("POST", "/api/skills", draft);
    // Skipped when already in place: every sharing change is an audit entry.
    if (skill.visibility !== "shared" || skill.alwaysOn !== alwaysOn)
      await api("PATCH", `/api/skills/${skill.id}`, { visibility: "shared", alwaysOn });
    console.log(`${current ? "updated" : "created"} ${draft.name} (shared${alwaysOn ? ", always-on" : ""})`);
  }
}

main().catch((err) => {
  console.error(`[import-skills] ${err.message}`);
  process.exit(1);
});
