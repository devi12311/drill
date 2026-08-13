import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEVERITY_CLASS, SEVERITY_FILLED } from "@/lib/monitoring/ui";
import type { Severity } from "@/lib/monitoring/types";

/**
 * A severity chip. `base` is shown alongside only when Holmes moved the
 * severity for this cluster's context — so drift from the catalogue is visible
 * rather than silently overwritten.
 */
export function SeverityBadge({
  severity,
  base,
  className,
}: {
  severity: Severity;
  base?: Severity;
  className?: string;
}) {
  const drifted = base !== undefined && base !== severity;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Badge
        variant="outline"
        className={cn(
          "uppercase",
          SEVERITY_CLASS[severity],
          SEVERITY_FILLED[severity] && "border-traffic-red/60 bg-traffic-red/10",
        )}
      >
        {severity}
      </Badge>
      {drifted && (
        <span className="text-caption-tracked text-bone-gray" title="Severity adjusted from the catalogue's base for this cluster's context">
          was {base}
        </span>
      )}
    </span>
  );
}
