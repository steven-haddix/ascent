import { useEffect, useState } from "react";
import { highlightCode } from "../../core/code/highlight";

/** Async Shiki wrapper: returns the highlighted HTML once the singleton highlighter
 *  is ready, or null while it's loading. Re-runs only when `code` or `lang` changes,
 *  and cancellation guards against stale resolves stomping a newer value. Streaming
 *  partial code is safe — Shiki gracefully renders incomplete source as plain text. */
export function useShikiHighlight(code: string, lang: string): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, lang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  return html;
}
