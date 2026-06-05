import type { ConceptRow } from "../core/store/repositories";

/** A concept plus its ordered children. `children` is `null` for leaf nodes (no
 *  sub-concepts), not `[]`: react-arborist treats a non-array `children` as a leaf
 *  (`isLeaf = !Array.isArray(children)`), which is what suppresses the expand toggle
 *  until sub-lessons are actually added. An empty array would instead render every
 *  node as an (empty) expandable folder. */
export type TreeNode = ConceptRow & { children: TreeNode[] | null };

/** Flat concept rows -> nested tree, grouped by `parentId` and ordered by `order`. */
export function buildTree(rows: ConceptRow[]): TreeNode[] {
  const byParent = new Map<string | null, ConceptRow[]>();
  for (const r of rows) {
    const key = r.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(r);
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.order - b.order)
      .map((r) => {
        const children = build(r.id);
        return { ...r, children: children.length > 0 ? children : null };
      });
  return build(null);
}

/** Group rows by parentId once — shared by the subtree walkers below. */
function childrenByParent(rows: ConceptRow[]): Map<string | null, ConceptRow[]> {
  const byParent = new Map<string | null, ConceptRow[]>();
  for (const r of rows) {
    const key = r.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(r);
  }
  return byParent;
}

/** `nodeId` plus every descendant id, depth-first. This is the cascade-delete set:
 *  deleting a node removes it and the whole branch beneath it. Order is the node
 *  first, then descendants — callers that need "descendants only" drop index 0. */
export function descendantIds(rows: ConceptRow[], nodeId: string): string[] {
  const byParent = childrenByParent(rows);
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of byParent.get(id) ?? []) walk(child.id);
  };
  walk(nodeId);
  return out;
}

/** The direct children of `nodeId` (one level down). This is the reparent set used
 *  by "keep sub-concepts": delete the node but move these up to its parent. */
export function childIds(rows: ConceptRow[], nodeId: string): string[] {
  return rows.filter((r) => r.parentId === nodeId).map((r) => r.id);
}
