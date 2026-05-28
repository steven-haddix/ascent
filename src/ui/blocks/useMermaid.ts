import { useEffect, useState } from "react";

type Core = typeof import("./mermaidCore");
let corePromise: Promise<Core> | null = null;
const loadCore = () => (corePromise ??= import("./mermaidCore"));

/** Render a Mermaid spec via a lazily-loaded mermaid. Returns the SVG once ready,
 *  or error=true on a parse failure (caller shows the source). Re-renders when the
 *  spec or theme changes. */
export function useMermaid(spec: string, themeKey: string): { svg: string | null; error: boolean } {
  const [state, setState] = useState<{ svg: string | null; error: boolean }>({ svg: null, error: false });
  useEffect(() => {
    let cancelled = false;
    setState({ svg: null, error: false });
    loadCore()
      .then((m) => m.renderMermaid(spec))
      .then((svg) => {
        if (!cancelled) setState({ svg, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ svg: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [spec, themeKey]);
  return state;
}
