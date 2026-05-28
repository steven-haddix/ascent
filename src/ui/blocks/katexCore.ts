// KaTeX render core — JS only. The stylesheet is imported eagerly in main.tsx
// (a static import the build resolves reliably); keeping the CSS import OUT of this
// lazily-imported module avoids a dev-server resolution failure that would make the
// whole module fail to load and silently fall back to raw LaTeX.
import katex from "katex";

export function renderLatex(latex: string, display: boolean): string {
  // throwOnError: false → invalid LaTeX renders as inline error text instead of
  // throwing, so a bad expression degrades gracefully rather than breaking the lesson.
  return katex.renderToString(latex, { throwOnError: false, displayMode: display });
}
