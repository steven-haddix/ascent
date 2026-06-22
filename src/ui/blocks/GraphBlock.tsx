import { useEffect, useState } from "react";
import type { SimulationNodeDatum } from "d3-force";
import type { Block } from "../../core/types";
import { isGraphBlock } from "../../core/visuals/guards";

// App-layer node–link graph. The model emits DATA (nodes/edges); we compute a static
// force-directed layout with d3-force (lazy-loaded chunk, like katex/mermaid) and render
// deterministic SVG. Reliable precisely because the model never writes code or geometry.
const W = 640;
const H = 440;
const GROUP_COLORS = ["var(--color-accent)", "#3b82f6", "#16a34a", "#a855f7", "#d97706", "#dc2626"];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type SimNode = SimulationNodeDatum & { id: string; label?: string; group?: string };

interface Pos {
  id: string;
  x: number;
  y: number;
  label: string;
  group?: string;
}

export function GraphBlock({ block }: { block: Block }) {
  const valid = isGraphBlock(block) && block.nodes.length > 0;
  const sig = valid ? JSON.stringify([block.nodes, block.edges]) : "";
  const [layout, setLayout] = useState<{
    nodes: Pos[];
    edges: { x1: number; y1: number; x2: number; y2: number }[];
  } | null>(null);

  useEffect(() => {
    if (!isGraphBlock(block) || block.nodes.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } = await import("d3-force");
      const nodes: SimNode[] = block.nodes.map((n) => ({ id: n.id, label: n.label ?? n.id, group: n.group }));
      const ids = new Set(nodes.map((n) => n.id));
      const links = block.edges
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => ({ source: e.from, target: e.to }));
      const sim = forceSimulation<SimNode>(nodes)
        .force("charge", forceManyBody().strength(-260))
        .force(
          "link",
          forceLink<SimNode, { source: string; target: string }>(links)
            .id((d) => d.id)
            .distance(78),
        )
        .force("center", forceCenter(W / 2, H / 2))
        .force("collide", forceCollide<SimNode>(30))
        .stop();
      sim.tick(320);
      if (cancelled) return;
      const pos: Pos[] = nodes.map((n) => ({
        id: n.id,
        x: clamp(n.x ?? W / 2, 34, W - 34),
        y: clamp(n.y ?? H / 2, 26, H - 26),
        label: n.label ?? n.id,
        group: n.group,
      }));
      const byId = new Map(pos.map((p) => [p.id, p]));
      const edges = block.edges
        .map((e) => ({ a: byId.get(e.from), b: byId.get(e.to) }))
        .filter((e): e is { a: Pos; b: Pos } => !!e.a && !!e.b)
        .map((e) => ({ x1: e.a.x, y1: e.a.y, x2: e.b.x, y2: e.b.y }));
      setLayout({ nodes: pos, edges });
    })();
    return () => {
      cancelled = true;
    };
  }, [sig, block]);

  if (!valid) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        Preparing graph…
      </div>
    );
  }
  const blockNodes = isGraphBlock(block) ? block.nodes : [];
  const groups = Array.from(new Set(blockNodes.map((n) => n.group).filter((g): g is string => !!g)));
  const colorOf = (g?: string) => (g ? GROUP_COLORS[groups.indexOf(g) % GROUP_COLORS.length] : GROUP_COLORS[0]);

  return (
    <figure className="my-6 font-sans" role="img" aria-label={block.alt || block.title || "Relationship graph"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {layout?.edges.map((e, i) => (
          <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--color-rule-strong)" strokeWidth={1} />
        ))}
        {layout?.nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={6} fill={colorOf(n.group)} />
            <text x={n.x} y={n.y - 10} textAnchor="middle" fontSize={11.5} fill="var(--color-ink)" fontFamily="var(--font-sans)">
              {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
            </text>
          </g>
        ))}
        {!layout && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="var(--color-ink-3)" fontFamily="var(--font-sans)">
            Laying out graph…
          </text>
        )}
      </svg>
      {block.title && <figcaption className="mt-1 text-center text-[11.5px] text-ink-3">{block.title}</figcaption>}
    </figure>
  );
}
