import type {
  ArtifactGraph,
  ArtifactGraphEdge,
  ArtifactGraphNode,
} from "@/lib/artifacts/types";

/**
 * Hand-rolled layered DAG for the failure-propagation graph (3–15 nodes).
 * Left→right: failure origins on the left, impact flows rightward.
 * Lives inside terminal-styled panels, so mono type and the gold/cobalt
 * accents are allowed here (DESIGN.md: code context).
 */

const NODE_W = 160;
const NODE_H = 44;
const LAYER_GAP = 210;
const ROW_GAP = 68;
const MARGIN = 16;

interface Positioned {
  node: ArtifactGraphNode;
  x: number;
  y: number;
  isOrigin: boolean;
}

interface LaidOutEdge {
  edge: ArtifactGraphEdge;
  path: string;
  labelX: number;
  labelY: number;
  isBack: boolean;
}

function layout(graph: ArtifactGraph) {
  const nodes = graph.nodes;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
  );

  // Cycle break: DFS; edges closing a cycle are drawn dashed and ignored
  // for layering.
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.source)!.push(e.target);
  const state = new Map<string, "visiting" | "done">();
  const backEdges = new Set<ArtifactGraphEdge>();
  const visit = (id: string) => {
    state.set(id, "visiting");
    for (const next of out.get(id)!) {
      if (state.get(next) === "visiting") {
        const e = edges.find(
          (x) => x.source === id && x.target === next && !backEdges.has(x),
        );
        if (e) backEdges.add(e);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    state.set(id, "done");
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  const forward = edges.filter((e) => !backEdges.has(e));

  // Longest-path layering over forward edges (Kahn order).
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of forward) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of forward.filter((x) => x.source === id)) {
      layer.set(e.target, Math.max(layer.get(e.target)!, layer.get(id)! + 1));
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }

  // Order within layers: 3 barycenter sweeps against the previous layer.
  const layers: ArtifactGraphNode[][] = [];
  for (const n of nodes) {
    const l = layer.get(n.id)!;
    (layers[l] ??= []).push(n);
  }
  const indexOf = new Map<string, number>();
  layers.forEach((l) => l.forEach((n, i) => indexOf.set(n.id, i)));
  const neighbors = (id: string, dir: "in" | "out") =>
    forward
      .filter((e) => (dir === "in" ? e.target === id : e.source === id))
      .map((e) => indexOf.get(dir === "in" ? e.source : e.target) ?? 0);
  for (let sweep = 0; sweep < 3; sweep++) {
    const dir = sweep % 2 === 0 ? "in" : "out";
    const range = dir === "in" ? layers : [...layers].reverse();
    for (const l of range) {
      l.sort((a, b) => {
        const mean = (id: string) => {
          const ns = neighbors(id, dir);
          return ns.length
            ? ns.reduce((s, x) => s + x, 0) / ns.length
            : (indexOf.get(id) ?? 0);
        };
        return mean(a.id) - mean(b.id);
      });
      l.forEach((n, i) => indexOf.set(n.id, i));
    }
  }

  // Coordinates: layers vertically centered against the tallest layer.
  const maxRows = Math.max(1, ...layers.map((l) => l.length));
  const positioned = new Map<string, Positioned>();
  const hasIncoming = new Set(forward.map((e) => e.target));
  layers.forEach((l, li) => {
    const offset = ((maxRows - l.length) * ROW_GAP) / 2;
    l.forEach((n, ri) => {
      positioned.set(n.id, {
        node: n,
        x: MARGIN + li * LAYER_GAP,
        y: MARGIN + offset + ri * ROW_GAP,
        isOrigin: !hasIncoming.has(n.id),
      });
    });
  });

  const laidOutEdges: LaidOutEdge[] = edges.map((e) => {
    const s = positioned.get(e.source)!;
    const t = positioned.get(e.target)!;
    const sx = s.x + NODE_W;
    const sy = s.y + NODE_H / 2;
    const tx = t.x;
    const ty = t.y + NODE_H / 2;
    const mid = (sx + tx) / 2;
    return {
      edge: e,
      path: `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2 - 7,
      isBack: backEdges.has(e),
    };
  });

  return {
    nodes: [...positioned.values()],
    edges: laidOutEdges,
    width: MARGIN * 2 + (layers.length - 1) * LAYER_GAP + NODE_W,
    height: MARGIN * 2 + (maxRows - 1) * ROW_GAP + NODE_H,
  };
}

const KIND_LABEL: Record<ArtifactGraphNode["kind"], string> = {
  service: "SVC",
  component: "CMP",
  datastore: "DB",
  external: "EXT",
};

export function ArtifactDag({ graph }: { graph: ArtifactGraph }) {
  if (!graph.nodes.length) {
    return (
      <div className="px-4 py-6 text-center font-mono text-[12px] text-bone-gray">
        no graph captured for this resolution
      </div>
    );
  }
  const { nodes, edges, width, height } = layout(graph);
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="mx-auto block max-w-full"
        role="img"
        aria-label="Failure propagation graph"
      >
        <defs>
          <marker
            id="dag-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-bone-gray" />
          </marker>
        </defs>
        {edges.map((e, i) => (
          <g key={`${e.edge.source}-${e.edge.target}-${i}`}>
            <path
              d={e.path}
              fill="none"
              strokeWidth="1.5"
              markerEnd="url(#dag-arrow)"
              strokeDasharray={e.isBack ? "4 3" : undefined}
              className="stroke-bone-gray"
            />
            {e.edge.label && (
              <>
                <text
                  x={e.labelX}
                  y={e.labelY}
                  textAnchor="middle"
                  className="fill-smoke-charcoal stroke-smoke-charcoal font-mono text-[10px]"
                  strokeWidth="7"
                  strokeLinejoin="round"
                >
                  {e.edge.label}
                </text>
                <text
                  x={e.labelX}
                  y={e.labelY}
                  textAnchor="middle"
                  className="fill-pale-stone font-mono text-[10px]"
                >
                  {e.edge.label}
                </text>
              </>
            )}
          </g>
        ))}
        {nodes.map((p) => (
          <g key={p.node.id}>
            <rect
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              rx="6"
              className={
                p.isOrigin
                  ? "fill-iron-veil stroke-gold-leaf"
                  : "fill-iron-veil stroke-slate-hearth"
              }
              strokeWidth={p.isOrigin ? 1.5 : 1}
            >
              <title>{p.node.label}</title>
            </rect>
            <text
              x={p.x + 10}
              y={p.y + 19}
              className="fill-warm-off-white font-mono text-[12px]"
            >
              {p.node.label.length > 20
                ? p.node.label.slice(0, 19) + "…"
                : p.node.label}
            </text>
            <text
              x={p.x + 10}
              y={p.y + 34}
              className="fill-muted-cobalt font-mono text-[9px] tracking-[0.15em]"
            >
              {KIND_LABEL[p.node.kind]}
              {p.isOrigin ? " · ORIGIN" : ""}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
