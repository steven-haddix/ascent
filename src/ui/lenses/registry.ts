import type { Lens } from "./types";
import type { LensId } from "../../core/types";
import { NotesLens } from "./NotesLens";
import { QuizLens } from "./QuizLens";
import { TeachLens } from "./TeachLens";
import { CodeLens } from "./CodeLens";
import { VizLens } from "./VizLens";
import { ResourcesLens } from "./ResourcesLens";
import { LibraryLens } from "./LibraryLens";

// Registered preview-pane lenses. `chat` is the bottom drawer (not here).
const LENSES: Partial<Record<LensId, Lens>> = {
  notes: { id: "notes", label: "Notes", icon: "✎", Renderer: NotesLens },
  quiz: { id: "quiz", label: "Quiz", icon: "?", Renderer: QuizLens },
  teach: { id: "teach", label: "Teach", icon: "◎", Renderer: TeachLens },
  code: { id: "code", label: "Code", icon: "<>", Renderer: CodeLens },
  viz: { id: "viz", label: "Viz", icon: "◫", Renderer: VizLens },
  resources: { id: "resources", label: "Sources", icon: "↗", Renderer: ResourcesLens },
  library: { id: "library", label: "Library", icon: "▤", Renderer: LibraryLens },
};

export function getLens(id: LensId): Lens | undefined {
  return LENSES[id];
}

/** The lenses a lesson declared that are renderable in the preview pane. */
export function getPreviewLenses(declared: LensId[]): Lens[] {
  return declared.map((id) => LENSES[id]).filter((l): l is Lens => Boolean(l));
}
