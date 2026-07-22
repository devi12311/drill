"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArtifactDag } from "./dag";
import { normalizeGraph, type ArtifactDraft } from "@/lib/artifacts/types";

/** Editor for one string-list field (symptoms, services, steps…). */
function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  mono,
  ordered,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  mono?: boolean;
  ordered?: boolean;
}) {
  const set = (i: number, value: string) =>
    onChange(items.map((item, idx) => (idx === i ? value : item)));
  return (
    <div className="space-y-2">
      <Label className="text-pale-stone">{label}</Label>
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {ordered && (
            <span className="mt-2 w-5 shrink-0 text-right font-mono text-[12px] text-bone-gray">
              {i + 1}.
            </span>
          )}
          <Textarea
            value={item}
            onChange={(e) => set(i, e.target.value)}
            rows={1}
            className={
              "min-h-9 flex-1 resize-y" + (mono ? " font-mono text-[13px]" : "")
            }
          />
          <button
            type="button"
            aria-label={`Remove ${label} item`}
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="mt-2 shrink-0 rounded-sm p-1 text-bone-gray hover:text-traffic-red"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-body-sm text-bone-gray hover:text-warm-off-white"
      >
        <Plus className="size-3.5" />
        add {placeholder}
      </button>
    </div>
  );
}

/**
 * Shared editable artifact fields — the resolve dialog (create) and the
 * detail page (edit) both render this. The graph is edited as raw JSON in
 * v1 with a live DAG preview.
 */
export function ArtifactForm({
  draft,
  onChange,
}: {
  draft: ArtifactDraft;
  onChange: (draft: ArtifactDraft) => void;
}) {
  const [graphText, setGraphText] = useState(() =>
    JSON.stringify(draft.graph, null, 2),
  );
  const [graphError, setGraphError] = useState<string | null>(null);

  function onGraphText(text: string) {
    setGraphText(text);
    try {
      onChange({ ...draft, graph: normalizeGraph(JSON.parse(text)) });
      setGraphError(null);
    } catch {
      setGraphError("invalid JSON — last valid graph kept");
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="art-title" className="text-pale-stone">
          Title
        </Label>
        <Input
          id="art-title"
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="art-summary" className="text-pale-stone">
          Summary
        </Label>
        <Textarea
          id="art-summary"
          rows={3}
          className="resize-y"
          value={draft.summary}
          onChange={(e) => onChange({ ...draft, summary: e.target.value })}
        />
      </div>

      <ListEditor
        label="Symptoms"
        items={draft.symptoms}
        onChange={(symptoms) => onChange({ ...draft, symptoms })}
        placeholder="symptom"
        mono
      />

      <ListEditor
        label="Affected services"
        items={draft.affected_services}
        onChange={(affected_services) =>
          onChange({ ...draft, affected_services })
        }
        placeholder="service"
        mono
      />

      <div className="space-y-2">
        <Label htmlFor="art-root-cause" className="text-pale-stone">
          Root cause
        </Label>
        <Textarea
          id="art-root-cause"
          rows={4}
          className="resize-y"
          value={draft.root_cause}
          onChange={(e) => onChange({ ...draft, root_cause: e.target.value })}
        />
      </div>

      <ListEditor
        label="Resolution steps"
        items={draft.resolution_steps}
        onChange={(resolution_steps) => onChange({ ...draft, resolution_steps })}
        placeholder="step"
        ordered
      />

      <ListEditor
        label="Verification steps"
        items={draft.verification_steps}
        onChange={(verification_steps) =>
          onChange({ ...draft, verification_steps })
        }
        placeholder="step"
        ordered
      />

      <div className="space-y-2">
        <Label htmlFor="art-tags" className="text-pale-stone">
          Tags <span className="text-bone-gray">(comma-separated)</span>
        </Label>
        <Input
          id="art-tags"
          className="font-mono text-[13px]"
          value={draft.tags.join(", ")}
          onChange={(e) =>
            onChange({
              ...draft,
              tags: e.target.value
                .split(",")
                .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
                .filter(Boolean),
            })
          }
        />
      </div>

      <div className="space-y-2">
        <Label className="text-pale-stone">Failure propagation graph</Label>
        <div className="rounded-lg bg-smoke-charcoal py-3">
          <ArtifactDag graph={draft.graph} />
        </div>
        <Textarea
          rows={6}
          className="resize-y font-mono text-[12px]"
          value={graphText}
          onChange={(e) => onGraphText(e.target.value)}
          aria-label="Graph JSON"
        />
        {graphError && (
          <p className="text-body-sm text-traffic-yellow">{graphError}</p>
        )}
      </div>
    </div>
  );
}
