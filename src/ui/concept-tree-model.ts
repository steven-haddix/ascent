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
