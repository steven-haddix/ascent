import type { Block } from "../../core/types";
import { useShikiHighlight } from "./useShikiHighlight";

/** Inline highlighted code block, rendered inside the lesson body. While Shiki is
 *  warming up (first call) or while text is still streaming in, falls back to a
 *  plain <pre> so the lesson stays readable. */
export function CodeBlock({ block }: { block: Block }) {
  const code = block.text ?? "";
  const language = block.language ?? "text";
  const html = useShikiHighlight(code, language);

  return (
    <div className="my-5 overflow-hidden rounded-md border border-rule">
      <div className="flex items-center justify-between border-b border-rule bg-surface-2 px-3 py-1 font-sans text-[10.5px] uppercase tracking-wider text-ink-3">
        <span>{language}</span>
      </div>
      {html ? (
        <div className="ascent-code" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="ascent-code-fallback m-0 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-ink-2">
          {code}
        </pre>
      )}
    </div>
  );
}
