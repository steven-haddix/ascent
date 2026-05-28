import type { Block } from "../../core/types";
import { HighlightedCode } from "./HighlightedCode";

/** Inline highlighted code block, rendered inside the lesson body. Wraps
 *  HighlightedCode with a language header so it reads as a contained snippet. */
export function CodeBlock({ block }: { block: Block }) {
  const code = block.text ?? "";
  const language = block.language ?? "text";
  return (
    <div className="my-5 overflow-hidden rounded-md border border-rule">
      <div className="flex items-center justify-between border-b border-rule bg-surface-2 px-3 py-1 font-sans text-[10.5px] uppercase tracking-wider text-ink-3">
        <span>{language}</span>
      </div>
      <HighlightedCode code={code} language={language} />
    </div>
  );
}
