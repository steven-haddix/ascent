import { useEffect, useRef } from "react";
import type { LessonFind } from "./useLessonFind";

/** Floating find-in-lesson bar, pinned top-right of the lesson pane. Presentational
 *  only — all state and search logic live in useLessonFind. Tagged data-find-ignore
 *  so its own text is never searched. */
export function FindBar({ find }: { find: LessonFind }) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the input when opened or when Ctrl+F is pressed again.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [find.focusNonce]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      find.close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) find.prev();
      else find.next();
    }
  };

  const counter = find.matchCount === 0 ? (find.query.trim() ? "0/0" : "") : `${find.activeIndex + 1}/${find.matchCount}`;
  const noMatch = find.query.trim().length > 0 && find.matchCount === 0;

  return (
    <div
      data-find-ignore
      className="absolute right-5 top-4 z-30 flex items-center gap-1.5 rounded-lg border border-rule bg-surface px-2 py-1.5 shadow-lg"
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-ink-3">
        <circle cx="6" cy="6" r="4" />
        <path d="M9 9 L12 12" />
      </svg>
      <input
        ref={inputRef}
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in lesson…"
        spellCheck={false}
        className="w-44 bg-transparent font-sans text-[12.5px] text-ink outline-none placeholder:text-ink-3"
      />
      <span className={`min-w-[34px] text-right font-mono text-[10.5px] tabular-nums ${noMatch ? "text-red-600" : "text-ink-3"}`}>
        {counter}
      </span>
      <div className="mx-0.5 h-4 w-px bg-rule" />
      <button
        onClick={find.prev}
        disabled={find.matchCount === 0}
        title="Previous match (⇧⏎)"
        className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 7.5 L6 4 L9 7.5" />
        </svg>
      </button>
      <button
        onClick={find.next}
        disabled={find.matchCount === 0}
        title="Next match (⏎)"
        className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 4.5 L6 8 L9 4.5" />
        </svg>
      </button>
      <button
        onClick={find.close}
        title="Close (Esc)"
        className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 3 L9 9 M9 3 L3 9" />
        </svg>
      </button>
    </div>
  );
}
