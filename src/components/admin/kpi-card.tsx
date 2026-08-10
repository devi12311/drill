import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="text-caption-tracked uppercase text-bone-gray">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-heading-sm",
          accent ? "text-gold-leaf" : "text-warm-off-white",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-body-sm text-bone-gray">{hint}</div>}
    </Card>
  );
}
