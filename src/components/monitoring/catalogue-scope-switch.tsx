import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CatalogueScope } from "@/lib/monitoring/catalogue-scope";

/**
 * Platform admins see two catalogues: their org's (what its jobs run) and the
 * shared templates (what every org inherits). A plain link pair, not a toggle in
 * state, so each view has its own URL and the server renders the right one.
 */
export function CatalogueScopeSwitch({
  path,
  scope,
}: {
  path: string;
  scope: CatalogueScope;
}) {
  const item = (target: CatalogueScope, label: string) => (
    <Link
      href={target === "templates" ? `${path}?scope=templates` : path}
      aria-current={scope === target ? "page" : undefined}
      className={cn(
        "rounded-sm px-3 py-1.5 text-body-sm transition-colors",
        scope === target
          ? "bg-smoke-charcoal text-warm-off-white"
          : "text-bone-gray hover:text-warm-off-white",
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex gap-1 rounded-md border border-border p-0.5">
      {item("org", "Your organization")}
      {item("templates", "Shared templates")}
    </div>
  );
}
