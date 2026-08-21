"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * The inventory's search box.
 *
 * The filter is a URL param and the matching happens in SQL, which is the reason
 * this page no longer ships hundreds of workloads to the browser. The cost of
 * that choice is a round-trip per query, so it is debounced and run inside a
 * transition — the input stays live while the table behind it updates, and it
 * `replace`s rather than pushes so Back leaves the page instead of walking back
 * through every prefix you typed.
 */
export function WorkloadFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const applied = params.get("q") ?? "";
  const [value, setValue] = useState(applied);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (value === applied) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      const qs = next.toString();
      startTransition(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [value, applied, params, pathname, router]);

  return (
    <div className="relative w-full max-w-[32ch]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-bone-gray" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Filter by namespace, name or technology"
        className="pl-8"
        aria-label="Filter workloads"
        aria-busy={pending}
        autoComplete="off"
      />
    </div>
  );
}
