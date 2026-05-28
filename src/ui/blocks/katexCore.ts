// KaTeX render core — isolated in its own module so it (and its CSS + fonts) land
// in a lazily-imported chunk. Only lessons that actually contain math pay for it.
import "katex/dist/katex.min.css";
import katex from "katex";

export function renderLatex(latex: string, display: boolean): string {
  // throwOnError: false → invalid LaTeX renders as inline error text instead of
  // throwing, so a bad expression degrades gracefully rather than breaking the lesson.
  return katex.renderToString(latex, { throwOnError: false, displayMode: display });
}
