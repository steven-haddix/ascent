// Per-kind block guards — renderers and logic narrow a flat `Block` to exactly the
// fields their kind owns, so invalid cross-kind states stay unreachable (Visual §2/§10).
import type { Block } from "../types";

export type TimelineBlock = Block & { kind: "timeline"; events: NonNullable<Block["events"]> };
export type SpectrumBlock = Block & {
  kind: "spectrum";
  axis: NonNullable<Block["axis"]>;
  items: NonNullable<Block["items"]>;
};

export function isTimelineBlock(b: Block): b is TimelineBlock {
  return b.kind === "timeline" && Array.isArray(b.events);
}

export function isSpectrumBlock(b: Block): b is SpectrumBlock {
  return b.kind === "spectrum" && !!b.axis && Array.isArray(b.items);
}

export type FigureBlock = Block & { kind: "figure"; figure: NonNullable<Block["figure"]> };
export function isFigureBlock(b: Block): b is FigureBlock {
  return b.kind === "figure" && !!b.figure;
}

export type GraphBlock = Block & {
  kind: "graph";
  nodes: NonNullable<Block["nodes"]>;
  edges: NonNullable<Block["edges"]>;
};
export function isGraphBlock(b: Block): b is GraphBlock {
  return b.kind === "graph" && Array.isArray(b.nodes) && Array.isArray(b.edges);
}

export type MapBlock = Block & { kind: "map"; marks: NonNullable<Block["marks"]> };
export function isMapBlock(b: Block): b is MapBlock {
  return b.kind === "map" && Array.isArray(b.marks);
}

export function isMediaBlock(b: Block): b is Block & { kind: "media"; mediaId: string } {
  return b.kind === "media" && !!b.mediaId;
}
