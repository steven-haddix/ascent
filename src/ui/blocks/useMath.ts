import { useEffect, useState } from "react";

type Core = typeof import("./katexCore");
let corePromise: Promise<Core> | null = null;
const loadCore = () => (corePromise ??= import("./katexCore"));

/** Render LaTeX to HTML via a lazily-loaded KaTeX. Returns null until ready, so
 *  callers can show the raw LaTeX as a fallback in the meantime. */
export function useMath(latex: string, display: boolean): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCore()
      .then((m) => {
        if (!cancelled) setHtml(m.renderLatex(latex, display));
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latex, display]);
  return html;
}
