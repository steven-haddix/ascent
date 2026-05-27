import type { ComponentType } from "react";
import type { ConceptRow } from "../../core/store/repositories";
import type { LensId } from "../../core/types";

export interface LensProps {
  concept: ConceptRow;
  ctx: { topicTitle: string; path: string[] };
}

/** A right-pane capability module. Lessons declare which lenses apply; the
 *  preview pane renders the registered ones (chat is the bottom drawer, not a
 *  preview lens). Code (M6) and Viz (v2) register here later. */
export interface Lens {
  id: LensId;
  label: string;
  icon: string;
  Renderer: ComponentType<LensProps>;
}
