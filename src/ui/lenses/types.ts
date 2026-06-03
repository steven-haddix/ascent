import type { ComponentType } from "react";
import type { ConceptRow } from "../../core/store/repositories";
import type { LensId } from "../../core/types";

export interface LensProps {
  concept: ConceptRow;
  /** all concepts in the active topic — lets a lens resolve links/forks against the live tree */
  concepts: ConceptRow[];
  ctx: { topicTitle: string; path: string[]; briefSummary?: string | null };
  /** fork a new concept (or link to an existing one) under the active concept; the
   *  single edge-creation site lives in App.handleFork. `opts.remedial` tags a
   *  teach-back gap fork. */
  onFork: (title: string, summary?: string, opts?: { remedial?: boolean }) => void;
  /** navigate to an existing concept without creating a node */
  onNavigate: (conceptId: string) => void;
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
