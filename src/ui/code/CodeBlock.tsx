import { useState } from "react";
import type { Block } from "../../core/types";
import { HighlightedCode } from "./HighlightedCode";

/** Inline code block, collapsed by default so the lesson body stays calm. The
 *  header shows the snippet's title (what it does) so a reader understands it
 *  without expanding; language + line count sit underneath as muted metadata.
 *  Click to reveal the Shiki-highlighted snippet. The Code tab (right pane)
 *  hosts the always-expanded, editable + runnable version. */
export function CodeBlock({ block }: { block: Block }) {
  const code = block.text ?? "";
  const language = block.language ?? "text";
  const title = block.title?.trim();
  const lineCount = code ? code.split("\n").length : 0;
  const meta = `${language}${lineCount > 0 ? ` · ${lineCount} ${lineCount === 1 ? "line" : "lines"}` : ""}`;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-5 overflow-hidden rounded-md border border-rule">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-3 bg-surface-2 px-3 py-1.5 text-left font-sans ${
          expanded ? "border-b border-rule" : ""
        }`}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          {title ? (
            <>
              <span className="truncate text-[12.5px] font-medium text-ink-2">{title}</span>
              <span className="text-[9.5px] uppercase tracking-wider text-ink-3">{meta}</span>
            </>
          ) : (
            <span className="text-[10.5px] uppercase tracking-wider text-ink-3">{meta}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10.5px] uppercase tracking-wider text-ink-3">
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
