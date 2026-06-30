import { useId, useState, type ReactNode } from "react";

export function CollapsibleBlockCard({
  title,
  meta,
  children,
  defaultExpanded = true,
  findIgnore = false,
}: {
  title: string;
  meta: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  findIgnore?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = useId();

  return (
    <div data-find-ignore={findIgnore || undefined} className="my-5 overflow-hidden rounded-md border border-rule">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className={`flex w-full items-center justify-between gap-3 bg-surface-2 px-3 py-1.5 text-left font-sans ${
          expanded ? "border-b border-rule" : ""
        }`}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[12.5px] font-medium text-ink-2">{title}</span>
          <span className="text-[9.5px] uppercase tracking-wider text-ink-3">{meta}</span>
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
            aria-hidden="true"
            style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
          >
            <path d="M2 3.5 L5 6.5 L8 3.5" />
          </svg>
        </span>
      </button>
      {expanded && <div id={bodyId}>{children}</div>}
    </div>
  );
}
