import type { Lens } from "./types";
import type { LensId } from "../../core/types";
import { NotesLens } from "./NotesLens";
import { QuizLens } from "./QuizLens";

// Registered preview-pane lenses. `chat` is the bottom drawer (not here);
// `code` (M6) and `viz` (v2) register here later.
const LENSES: Partial<Record<LensId, Lens>> = {
  notes: { id: "notes", label: "Notes", icon: "✎", Renderer: NotesLens },
  quiz: { id: "quiz", label: "Quiz", icon: "?", Renderer: QuizLens },
};

export function getLens(id: LensId): Lens | undefined {
  return LENSES[id];
}

/** The lenses a lesson declared that are renderable in the preview pane. */
export function getPreviewLenses(declared: LensId[]): Lens[] {
  return declared.map((id) => LENSES[id]).filter((l): l is Lens => Boolean(l));
}
