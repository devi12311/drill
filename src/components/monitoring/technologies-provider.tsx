"use client";

import { createContext, useContext, useMemo } from "react";
import { CLUSTER_TECHNOLOGY } from "@/lib/monitoring/workload-types";

export interface TechnologyOption {
  slug: string;
  label: string;
  enabled: boolean;
}

interface Technologies {
  /** Display name for a slug; a slug no type defines any more shows as itself. */
  label: (slug: string) => string;
  /** Every type plus the cluster, in priority order — for check scopes and shelves. */
  all: TechnologyOption[];
  /** What a WORKLOAD may be set to: enabled types, never the cluster. */
  assignable: TechnologyOption[];
}

const TechnologiesContext = createContext<TechnologyOption[]>([]);

/**
 * The org's workload types, read once by the monitoring layout and shared with
 * every screen under it (decision 128). Replaces the static label map that made
 * the vocabulary a code constant.
 */
export function TechnologiesProvider({
  technologies,
  children,
}: {
  technologies: TechnologyOption[];
  children: React.ReactNode;
}) {
  return (
    <TechnologiesContext.Provider value={technologies}>{children}</TechnologiesContext.Provider>
  );
}

export function useTechnologies(): Technologies {
  const all = useContext(TechnologiesContext);
  return useMemo(() => {
    const labels = new Map(all.map((t) => [t.slug, t.label]));
    return {
      label: (slug) => labels.get(slug) ?? slug,
      all,
      assignable: all.filter((t) => t.enabled && t.slug !== CLUSTER_TECHNOLOGY),
    };
  }, [all]);
}
