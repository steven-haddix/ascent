import { useState } from "react";
import type { Block } from "../../core/types";
import { HighlightedCode } from "./HighlightedCode";

/** Inline code block, collapsed by default so the lesson body stays calm — click
 *  the header to reveal the Shiki-highlighted snippet in place. The Code tab
 *  (right pane) still hosts the always-expanded, editable + runnable version. */
export function CodeBlock({ block }: { block: Block }) {
  const code = block.text ?? "";
  const language = block.language ?? "text";
  const lineCount = code ? code.split("\n").length : 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-5 overflow-hidden rounded-md border border-rule">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between bg-surface-2 px-3 py-1.5 font-sans text-[10.5px] uppercase tracking-wider text-ink-3 hover:text-ink ${
          expanded ? "border-b border-rule" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <span>{language}</span>
          {lineCount > 0 && (
            <span className="text-ink-3">
              · {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 normal-case tracking-normal">
          {expanded ? "Hide" : "Show"}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
          >
            <path d="M2 3.5 L5 6.5 L8 3.5" />
          </svg>
        </span>
      </button>
      {expanded && <HighlightedCode code={code} language={language} />}
    </div>
  );
}
