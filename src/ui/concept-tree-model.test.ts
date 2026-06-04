import { describe, expect, it } from "vitest";
import { buildTree } from "./concept-tree-model";
import type { ConceptRow } from "../core/store/repositories";

/** A ConceptRow with sensible defaults — tests only set what they care about. */
function row(partial: Partial<ConceptRow> & Pick<ConceptRow, "id">): ConceptRow {
  return {
    topicId: "t1",
    parentId: null,
    title: partial.id,
    summary: null,
    status: "queued",
    mastery: 0,
    order: 0,
    state: "outline",
    remedial: false,
    createdAt: 0,
    ...partial,
  };
}

describe("buildTree", () => {
  it("gives childless nodes null children (so leaves render no expand toggle)", () => {
    const tree = buildTree([row({ id: "a" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toBeNull();
  });

  it("gives a node with children a non-empty array (so the toggle appears)", () => {
    const tree = buildTree([row({ id: "parent" }), row({ id: "child", parentId: "parent" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("parent");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].id).toBe("child");
    // the child, having no children of its own, is a leaf
    expect(tree[0].children?.[0].children).toBeNull();
  });

  it("orders siblings by `order`", () => {
    const tree = buildTree([row({ id: "b", order: 2 }), row({ id: "a", order: 1 }), row({ id: "c", order: 3 })]);
    expect(tree.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("nests multiple levels and supports multiple roots", () => {
    const tree = buildTree([
      row({ id: "r1", order: 1 }),
      row({ id: "r2", order: 2 }),
      row({ id: "r1a", parentId: "r1", order: 1 }),
      row({ id: "r1a-x", parentId: "r1a", order: 1 }),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["r1", "r2"]);
    expect(tree[0].children?.map((n) => n.id)).toEqual(["r1a"]);
    expect(tree[0].children?.[0].children?.map((n) => n.id)).toEqual(["r1a-x"]);
    expect(tree[1].children).toBeNull();
  });
});
