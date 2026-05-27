import { useEffect, useRef, useState } from "react";
import { Tree, type NodeRendererProps } from "react-arborist";
import type { ConceptRow } from "../core/store/repositories";

type TreeNode = ConceptRow & { children: TreeNode[] };

/** Flat concept rows -> nested tree (by parentId, ordered). */
function buildTree(rows: ConceptRow[]): TreeNode[] {
  const byParent = new Map<string | null, ConceptRow[]>();
  for (const r of rows) {
    const key = r.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(r);
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ ...r, children: build(r.id) }));
  return build(null);
}

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

  const Node = ({ node, style }: NodeRendererProps<TreeNode>) => {
    const c = node.data;
    const selected = c.id === selectedId;
    return (
      <div
        style={style}
        onClick={() => onSelect(c.id)}
        className={`flex h-7 cursor-pointer items-center gap-2 pr-2.5 text-[12.5px] ${
          selected ? "bg-accent/10 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
        }`}
      >
        {node.isLeaf ? (
          <span className="inline-block h-3.5 w-3.5" />
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
            className="grid h-3.5 w-3.5 place-items-center text-ink-3"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: node.isOpen ? "rotate(90deg)" : "none" }}>
              <path d="M2 1 L6 4 L2 7" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </button>
        )}
        <StatusDot status={c.status} />
        <span className="flex-1 truncate">{c.title}</span>
        {c.mastery > 0 && <span className="font-mono text-[10px] text-ink-3">{Math.round(c.mastery * 100)}</span>}
      </div>
    );
  };

  return (
    <div ref={ref} className="h-full">
      <Tree<TreeNode>
        data={data}
        openByDefault
        width={width || 240}
        height={height || 400}
        rowHeight={28}
        indent={14}
        disableDrag
        disableDrop
      >
        {Node}
      </Tree>
    </div>
  );
}
