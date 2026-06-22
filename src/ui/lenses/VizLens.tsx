import type { LensProps } from "./types";
import type { Block } from "../../core/types";
import { useLessonRow } from "../../core/store/hooks";
import { visualRenderers } from "../blocks/registry";
import { ChartBlock } from "../blocks/ChartBlock";
import { DiagramBlock } from "../blocks/DiagramBlock";

// The Viz lens (Visual Learning System §8): a gallery of a lesson's visuals at full pane
// width — re-rendered from the same registry the lesson body uses, with media attribution
// shown by MediaBlock itself. Declared by the generator when a lesson emits ≥1 visual.
const VISUAL_KINDS = new Set<Block["kind"]>([
  "chart",
  "diagram",
  "timeline",
  "spectrum",
  "figure",
  "graph",
  "map",
  "media",
]);

function VizItem({ block, conceptId }: { block: Block; conceptId: string }) {
  const def = visualRenderers[block.kind];
  if (def) {
    const Component = def.Component;
    return def.isRenderable(block) ? <Component block={block} conceptId={conceptId} /> : null;
  }
  if (block.kind === "chart") return <ChartBlock block={block} />;
  if (block.kind === "diagram") return <DiagramBlock block={block} />;
  return null;
}

export function VizLens({ concept }: LensProps) {
  const q = useLessonRow(concept.id);
  const blocks = q.data?.blocks ?? [];
  const visuals = blocks.filter((b) => VISUAL_KINDS.has(b.kind));

  if (visuals.length === 0) {
    return <div className="p-4 font-sans text-[12.5px] text-ink-3">No visuals in this lesson yet.</div>;
  }
  return (
    <div className="flex flex-col gap-7 p-1 font-sans">
      {visuals.map((b, i) => (
        <div key={i}>
          {b.title && <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{b.title}</div>}
          <VizItem block={b} conceptId={concept.id} />
        </div>
      ))}
    </div>
  );
}
