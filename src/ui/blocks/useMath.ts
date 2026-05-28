import { useEffect, useState } from "react";
import { dlog } from "../../core/debug";

type Core = typeof import("./katexCore");
let corePromise: Promise<Core> | null = null;
function loadCore(): Promise<Core> {
  if (!corePromise) {
    corePromise = import("./katexCore");
    // Don't cache a failed load — a transient import error would otherwise wedge
    // every equation into the raw fallback until a full reload.
    corePromise.catch(() => {
      corePromise = null;
    });
  }
  return corePromise;
}

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
      .catch((e) => {
        dlog("math", "render failed:", e instanceof Error ? e.message : e);
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latex, display]);
  return html;
}
