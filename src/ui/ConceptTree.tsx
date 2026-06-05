import { useEffect, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";
import type { ConceptRow } from "../core/store/repositories";
import { useLessonStreaming } from "../core/store/hooks";
import { buildTree, childIds, descendantIds, type TreeNode } from "./concept-tree-model";

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

/** Where a row's action menu was opened, plus the node it targets. Positioned
 *  fixed at the anchor point (button corner or right-click location). */
interface MenuState {
  node: NodeApi<TreeNode>;
  x: number;
  y: number;
}

/** One tree row. A real component (not an inline closure) so the streaming hook
 *  is safe under react-arborist's row virtualization. */
function NodeRow({
  node,
  style,
  selectedId,
  onSelect,
  onOpenMenu,
  menuActive,
}: {
  node: NodeApi<TreeNode>;
  style: React.CSSProperties;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenMenu: (menu: MenuState) => void;
  menuActive: boolean;
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
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu({ node, x: e.clientX, y: e.clientY });
      }}
      className={`group relative flex h-7 cursor-pointer items-center gap-2 pr-2.5 text-[12.5px] ${
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
      {/* Hover-reveal ⋯ — stays visible while this row's menu is open. */}
      <button
        aria-label="Concept actions"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onOpenMenu({ node, x: r.right, y: r.bottom });
        }}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink ${
          menuActive ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
          <circle cx="6.5" cy="2.5" r="1.1" />
          <circle cx="6.5" cy="6.5" r="1.1" />
          <circle cx="6.5" cy="10.5" r="1.1" />
        </svg>
      </button>
    </div>
  );
}

/** The little action menu popped from a row's ⋯ / right-click. One item for now
 *  (Delete); disabled on a topic root since whole-topic deletion isn't supported
 *  from the tree. A full-screen transparent backdrop closes it on any outside click. */
function RowMenu({
  menu,
  onClose,
  onDelete,
}: {
  menu: MenuState;
  onClose: () => void;
  onDelete: () => void;
}) {
  const isRoot = menu.node.level === 0;
  // Keep the menu on-screen if opened near the right/bottom edge.
  const left = Math.min(menu.x, window.innerWidth - 168);
  const top = Math.min(menu.y, window.innerHeight - 60);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 w-40 overflow-hidden rounded-md border border-rule bg-surface py-1 shadow-lg"
        style={{ left, top }}
      >
        <button
          disabled={isRoot}
          title={isRoot ? "Deleting a whole topic isn't supported here yet" : undefined}
          onClick={() => {
            if (isRoot) return;
            onDelete();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${
            isRoot ? "cursor-not-allowed text-ink-3/50" : "text-red-600 hover:bg-red-400/10"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M2.5 3h7 M4.5 3V2h3v1 M3.5 3l.5 7h4l.5-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Delete
        </button>
      </div>
    </>
  );
}

/** Confirm dialog for deleting a concept. Spells out the blast radius and offers
 *  "keep sub-concepts" (reparent the direct children up) instead of a full cascade. */
function DeleteDialog({
  node,
  concepts,
  onCancel,
  onConfirm,
}: {
  node: NodeApi<TreeNode>;
  concepts: ConceptRow[];
  onCancel: () => void;
  onConfirm: (keepChildren: boolean) => void;
}) {
  const [keepChildren, setKeepChildren] = useState(false);
  const id = node.data.id;
  const directChildren = childIds(concepts, id).length;
  const descendants = descendantIds(concepts, id).length - 1; // exclude the node itself
  const parentTitle =
    node.data.parentId != null ? (concepts.find((c) => c.id === node.data.parentId)?.title ?? "its parent") : "its parent";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-lg border border-rule bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-serif text-base text-ink">
          Delete “<span className="font-medium">{node.data.title}</span>”?
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          {descendants === 0 ? (
            <>This removes its lesson, notes, highlights, and chat. This can’t be undone.</>
          ) : keepChildren ? (
            <>
              This concept is deleted; its{" "}
              <span className="font-medium text-ink">
                {directChildren} direct {directChildren === 1 ? "child" : "children"}
              </span>{" "}
              move up under “{parentTitle}”. This can’t be undone.
            </>
          ) : (
            <>
              This also deletes{" "}
              <span className="font-medium text-ink">
                {descendants} sub-{descendants === 1 ? "concept" : "concepts"}
              </span>{" "}
              and everything under them. This can’t be undone.
            </>
          )}
        </p>
        {directChildren > 0 && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              checked={keepChildren}
              onChange={(e) => setKeepChildren(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Keep sub-concepts (move them up)
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(keepChildren)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConceptTree({
  concepts,
  selectedId,
  onSelect,
  onDeleteConcept,
}: {
  concepts: ConceptRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Delete a node. `keepChildren` reparents its direct children up instead of
   *  cascading. The tree owns the menu + confirm UI; the host runs the mutation
   *  and fixes selection. */
  onDeleteConcept: (nodeId: string, keepChildren: boolean) => void;
}) {
  const data = buildTree(concepts);
  const [ref, { width, height }] = useSize();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<NodeApi<TreeNode> | null>(null);

  const Node = ({ node, style }: NodeRendererProps<TreeNode>) => (
    <NodeRow
      node={node}
      style={style}
      selectedId={selectedId}
      onSelect={onSelect}
      onOpenMenu={setMenu}
      menuActive={menu?.node.data.id === node.data.id}
    />
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
      {menu && (
        <RowMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onDelete={() => {
            setConfirm(menu.node);
            setMenu(null);
          }}
        />
      )}
      {confirm && (
        <DeleteDialog
          node={confirm}
          concepts={concepts}
          onCancel={() => setConfirm(null)}
          onConfirm={(keepChildren) => {
            onDeleteConcept(confirm.data.id, keepChildren);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
