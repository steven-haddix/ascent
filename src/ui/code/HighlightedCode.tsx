import { useShikiHighlight } from "./useShikiHighlight";

/** Pure highlighted code body — no chrome. Wrap it with your own border/header
 *  (CodeBlock does, CodeRunner does). While Shiki warms up or text is still
 *  streaming, falls back to a plain <pre> so content stays readable. */
export function HighlightedCode({ code, language }: { code: string; language: string }) {
  const html = useShikiHighlight(code, language);
  return html ? (
    <div className="ascent-code" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre className="ascent-code-fallback m-0 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-ink-2">
      {code}
    </pre>
  );
}
