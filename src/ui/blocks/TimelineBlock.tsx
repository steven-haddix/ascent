import type { Block } from "../../core/types";
import { isTimelineBlock } from "../../core/visuals/guards";

// Native, dependency-free vertical timeline (events on an era/time spine). Themed via
// token colors; offline. The humanities workhorse for chronology — history, biography,
// the evolution of an idea. The model emits structured `events`; we render deterministically.
export function TimelineBlock({ block }: { block: Block }) {
  if (!isTimelineBlock(block) || block.events.length === 0) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        Preparing timeline…
      </div>
    );
  }
  const events = block.events;
  const lanes = block.lanes?.filter((l) => l.trim().length > 0) ?? [];
  return (
    <figure className="my-6 font-sans" role="img" aria-label={block.alt || block.title || "Timeline"}>
      {lanes.length > 0 && (
        <div className="mb-2 text-[11.5px] text-ink-3">Tracks: {lanes.join(" · ")}</div>
      )}
      <ol className="relative ml-2 border-l border-rule-strong pl-0">
        {events.map((e, i) => (
          <li key={i} className="relative mb-5 pl-5 last:mb-0">
            <span
              className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent"
              aria-hidden="true"
            />
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{e.at}</div>
            <div className="text-[14px] font-medium leading-snug text-ink">{e.label}</div>
            {e.detail && <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{e.detail}</div>}
          </li>
        ))}
      </ol>
      {block.title && <figcaption className="mt-2 text-[11.5px] text-ink-3">{block.title}</figcaption>}
    </figure>
  );
}
