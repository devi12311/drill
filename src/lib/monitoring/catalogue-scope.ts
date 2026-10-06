/**
 * Which catalogue the check and playbook screens edit. Client-safe: the screens
 * build their API URLs with it and the routes parse it back.
 *
 * - `org` (the default): the active org's EFFECTIVE catalogue — its own copies
 *   where it has them, the templates elsewhere. Editing a template here forks it.
 * - `templates`: the templates themselves, which every org inherits. Platform
 *   admins only.
 */
export type CatalogueScope = "org" | "templates";

export function parseCatalogueScope(raw: string | null | undefined): CatalogueScope {
  return raw === "templates" ? "templates" : "org";
}

/** `url` addressed to `scope` — the default needs no parameter. */
export function scopedUrl(url: string, scope: CatalogueScope): string {
  if (scope === "org") return url;
  return `${url}${url.includes("?") ? "&" : "?"}scope=templates`;
}

/** Where an effective entry comes from, as the screens label it. */
export const SOURCE_LABEL = {
  template: "template",
  override: "customized",
  custom: "custom",
} as const;
