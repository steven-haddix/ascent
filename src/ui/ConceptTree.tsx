import { useEffect, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";
import type { ConceptRow } from "../core/store/repositories";
import { useLessonStreaming } from "../core/store/hooks";
import { buildTree, type TreeNode } from "./concept-tree-model";

/** Row geometry. INDENT (px per depth level) drives both react-arborist's own
 *  indentation and the connector lines, so they stay in lockstep. */
const INDENT = 14;
const ROW_H = 28;
/** x of a connector's vertical within its indent column — the center of the chevron
 *  column, so lines appear to drop from directly under the parent's expand toggle. */
const GUIDE_X = INDENT / 2;

/** Measures the container so react-arborist (which virtualizes) can size itself. */
function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Per-row tree connector lines (the ├─ / └─ "elbows"). react-arborist virtualizes
 *  rows, so we can't draw one continuous SVG down the tree; instead each row paints
 *  its own short segments at every ancestor depth and, stacked, they read as
 *  continuous lines. A column's vertical is drawn only while that ancestor still has
 *  a sibling below it (`nextSibling`) — that's what makes lines terminate at the last
 *  child (└) instead of dangling. The SVG is shifted left to span the row's indent
 *  band (react-arborist puts that band in `paddingLeft`, so it's our containing
 *  block's left padding). Roots (level 0) have no parent, hence no lines. */
function TreeGuides({ node }: { node: NodeApi<TreeNode> }) {
  const level = node.level;
  if (level === 0) return null;

  const width = level * INDENT;
  const mid = ROW_H / 2;
  const lines: React.ReactNode[] = [];

  // Pass-through verticals for ancestor columns (1 .. level-1).
  let ancestor = node.parent;
  for (let k = level - 1; k >= 1; k--) {
    if (ancestor?.nextSibling) {
      const x = (k - 1) * INDENT + GUIDE_X;
      lines.push(<line key={`anc-${k}`} x1={x} y1={0} x2={x} y2={ROW_H} />);
    }
    ancestor = ancestor?.parent ?? null;
  }

  // This node's own elbow: vertical down to the mid-line (continuing to the bottom
  // only if a sibling follows), then a horizontal tick out to the row content.
  const x = (level - 1) * INDENT + GUIDE_X;
  lines.push(<line key="elbow-v" x1={x} y1={0} x2={x} y2={node.nextSibling ? ROW_H : mid} />);
  lines.push(<line key="elbow-h" x1={x} y1={mid} x2={width} y2={mid} />);

  return (
    <svg
      aria-hidden
      width={width}
      height={ROW_H}
      stroke="currentColor"
      strokeWidth={1}
      shapeRendering="crispEdges"
      className="pointer-events-none absolute left-0 top-0 text-rule"
    >
      {lines}
    </svg>
  );
}

function StatusDot({ status }: { status: ConceptRow["status"] }) {
  const fill =
    status === "complete" || status === "current"
      ? "var(--color-accent)"
      : status === "visited"
        ? "var(--color-ink-2)"
        : "transparent";
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full border"
      style={{ background: fill, borderColor: status === "queued" ? "var(--color-rule)" : "transparent" }}
    />
  );
}

/** One tree row. A real component (not an inline closure) so the streaming hook
 *  is safe under react-arborist's row virtualization. */
function NodeRow({
  node,
  style,
  selectedId,
  onSelect,
}: {
  node: NodeApi<TreeNode>;
  style: React.CSSProperties;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const c = node.data;
  const selected = c.id === selectedId;
  const loading = useLessonStreaming(c.id);
  return (
    <div
      style={style}
      onClick={() => {
        onSelect(c.id);
        // Click anywhere on a collapsed folder opens it; an already-open folder is
        // left open (collapse stays on the chevron) so selecting a parent to read
        // its lesson never hides the child you were navigating toward.
        if (node.isInternal && node.isClosed) node.open();
      }}
      className={`relative flex h-7 cursor-pointer items-center gap-2 pr-2.5 text-[12.5px] ${
        selected ? "bg-accent/10 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <TreeGuides node={node} />
      {node.isLeaf ? (
        <span className="inline-block h-3.5 w-3.5 shrink-0" />
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
          aria-label={node.isOpen ? "Collapse" : "Expand"}
          className="grid h-7 w-3.5 shrink-0 place-items-center text-ink-3 hover:text-ink"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            className="transition-transform duration-150 ease-out"
            style={{ transform: node.isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <path d="M2 1 L6 4 L2 7" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </button>
      )}
      <StatusDot status={c.status} />
      <span className="flex-1 truncate">{c.title}</span>
      {c.remedial && (
        <span title="Remedial branch — from a teach-back gap" className="shrink-0 font-mono text-[10px] text-accent">
          ↻
        </span>
      )}
      {loading ? (
        <span
          title="Generating lesson…"
          className="h-3 w-3 shrink-0 animate-spin rounded-full border border-rule border-t-accent"
        />
      ) : (
        c.mastery > 0 && <span className="font-mono text-[10px] text-ink-3">{Math.round(c.mastery * 100)}</span>
      )}
    </div>
  );
}

export function ConceptTree({
  concepts,
  selectedId,
  onSelect,
}: {
  concepts: ConceptRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const data = buildTree(concepts);
  const [ref, { width, height }] = useSize();

  const Node = ({ node, style }: NodeRendererProps<TreeNode>) => (
    <NodeRow node={node} style={style} selectedId={selectedId} onSelect={onSelect} />
  );

  return (
    <div ref={ref} className="h-full pl-3.5">
      <Tree<TreeNode>
        data={data}
        openByDefault
        width={width || 240}
        height={height || 400}
        rowHeight={ROW_H}
        indent={INDENT}
        disableDrag
        disableDrop
      >
        {Node}
      </Tree>
    </div>
  );
}
