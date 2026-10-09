/**
 * `{{key}}` placeholders in prompt text authored in Drill — monitoring playbooks
 * and skills. One implementation, so what the editor validates is exactly what
 * gets substituted.
 */

const PLACEHOLDER_PATTERN = /\{\{([^}]*)\}\}/g;

/** Every placeholder name used in `text`, trimmed, in order of appearance. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map(([, inner]) => inner.trim());
}

/**
 * Throws when `text` uses a placeholder outside `allowed` — an unknown one would
 * reach the model as literal braces, which reads like an instruction to fill in.
 */
export function assertPlaceholders(
  text: string,
  allowed: readonly string[],
  field: string,
): void {
  for (const name of placeholdersIn(text)) {
    if (!allowed.includes(name)) {
      const known = allowed.length
        ? `Only ${allowed.map((a) => `{{${a}}}`).join(", ")} ${allowed.length === 1 ? "is" : "are"} substituted`
        : "Nothing is substituted here";
      throw new Error(
        `${field} uses an unknown placeholder {{${name}}}. ${known} — anything else reaches the model as literal text.`,
      );
    }
  }
}

/** Replace every placeholder with what `fn` makes of its (trimmed) name. */
export function mapPlaceholders(text: string, fn: (name: string) => string): string {
  return text.replace(PLACEHOLDER_PATTERN, (_, inner: string) => fn(inner.trim()));
}

/** Substitute `vars` into `text`; a placeholder with no value becomes "". */
export function renderTemplate(
  text: string,
  vars: Readonly<Record<string, string>>,
): string {
  return mapPlaceholders(text, (name) => vars[name] ?? "");
}
