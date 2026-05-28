import { Fragment, useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  /** subtitle — breadcrumb path for concepts, short description for actions */
  hint?: string;
  /** group header the command renders under */
  section: string;
  /** extra searchable text not shown in the label */
  keywords?: string;
  run: () => void;
}

/** ⌘K command palette: fuzzy-filter concepts to jump to + a few actions. Fully
 *  keyboard-driven (↑/↓ move, Enter runs, Esc closes); click and hover work too. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [query, commands]);

  // Reset the highlight to the top whenever the result set changes.
  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (cmd?: Command) => {
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-6 pt-[12vh]" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-rule bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="shrink-0 text-ink-3">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a concept or run a command…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
          />
          <span className="rounded border border-rule bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">esc</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink-3">No matches</div>
          ) : (
            filtered.map((cmd, idx) => {
              const showHeader = idx === 0 || cmd.section !== filtered[idx - 1].section;
              return (
                <Fragment key={cmd.id}>
                  {showHeader && (
                    <div className="px-4 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-ink-3">
                      {cmd.section}
                    </div>
                  )}
                  <button
                    ref={idx === active ? activeRef : undefined}
                    onClick={() => run(cmd)}
                    onMouseMove={() => setActive(idx)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left ${
                      idx === active ? "bg-accent/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] text-ink">{cmd.label}</span>
                      {cmd.hint && <span className="truncate text-[11.5px] text-ink-3">{cmd.hint}</span>}
                    </span>
                    {idx === active && <span className="shrink-0 font-mono text-[11px] text-ink-3">↵</span>}
                  </button>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
