// Visual Registry — the renderer facet (Visual Learning System §2). Maps a visual
// block kind to its renderer so `renderBlock` dispatches through the registry instead
// of a growing `kind === …` ladder. New visual kinds register here (UI layer) — this
// is the src/core → src/ui boundary the catalog/authoring facets stay clear of.
//
// Legacy inline kinds (paragraph/section/callout/code/table/math/chart/diagram/widget)
// remain in LessonPane's switch; the registry owns the ADDITIVE visual kinds (timeline,
// spectrum now; figure/graph/map/media as later waves land their renderers).
import type { ComponentType } from "react";
import type { Block } from "../../core/types";
import {
  isTimelineBlock,
  isSpectrumBlock,
  isFigureBlock,
  isGraphBlock,
  isMapBlock,
  isMediaBlock,
  isGeneratedImageBlock,
} from "../../core/visuals/guards";
import { TimelineBlock } from "./TimelineBlock";
import { SpectrumBlock } from "./SpectrumBlock";
import { FigureBlock } from "./FigureBlock";
import { GraphBlock } from "./GraphBlock";
import { MapBlock } from "./MapBlock";
import { MediaBlock } from "./MediaBlock";
import { GeneratedImageBlock } from "./GeneratedImageBlock";

export interface VisualRendererDefinition {
  /** per-kind gate: is this block well-formed enough to render? */
  isRenderable: (b: Block) => boolean;
  /** conceptId is passed for job-backed kinds (media) that join an async-resolved row;
   *  inline kinds simply ignore it. */
  Component: ComponentType<{ block: Block; conceptId?: string }>;
}

export const visualRenderers: Partial<Record<Block["kind"], VisualRendererDefinition>> = {
  timeline: { isRenderable: isTimelineBlock, Component: TimelineBlock },
  spectrum: { isRenderable: isSpectrumBlock, Component: SpectrumBlock },
  figure: { isRenderable: isFigureBlock, Component: FigureBlock },
  graph: { isRenderable: isGraphBlock, Component: GraphBlock },
  map: { isRenderable: isMapBlock, Component: MapBlock },
  media: { isRenderable: isMediaBlock, Component: MediaBlock },
  "generated-image": { isRenderable: isGeneratedImageBlock, Component: GeneratedImageBlock },
};
