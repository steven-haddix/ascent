import { useQuery } from "@tanstack/react-query";
import { sourceRepo } from "../core/store/repositories";
import { useIntakeSession } from "../core/generation/intakeSession";

// The right-pane Brief during topic creation (topic-creation design): a live,
// read-only mirror of the intake session — topic, attached sources, interview
// facets, and the synthesized summary. Shares the intakeSession store with the
// center flow, so it fills in as the learner answers. Status walks BUILDING
// (compose/interview) → READY (brief) → LOCKED (creating/done).
const PROCESSING = new Set(["queued", "fetching", "extracting", "chunking", "indexing"]);

export function IntakeBriefPanel() {
  const s = useIntakeSession();
  const docs = useQuery({
    queryKey: ["library", s.draftTopicId],
    queryFn: () => sourceRepo.listByTopic(s.draftTopicId as string),
    enabled: !!s.draftTopicId,
  });
  const docRows = docs.data ?? [];

  const hasContent = s.title.trim() || docRows.length > 0 || s.facets.length > 0;
  if (!hasContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-sm text-ink-2">Building your brief</p>
        <p className="max-w-[30ch] text-[12px] text-ink-3">
          Name a topic and answer a few questions — your brief takes shape here.
        </p>
      </div>
    );
  }

  const status =
    s.phase === "creating" || s.phase === "done" ? "LOCKED" : s.phase === "brief" ? "READY" : "BUILDING";
  const statusColor =
    status === "LOCKED" ? "text-ink-4" : status === "READY" ? "text-accent" : "text-amber-500";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-4">Brief</span>
        <span className={`flex items-center gap-1.5 font-mono text-[10px] ${statusColor}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
      </div>

      <div className="px-4 py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-4">Topic</div>
        <div className="mt-1 font-serif text-lg text-ink">{s.title || "Untitled"}</div>
      </div>

      {docRows.length > 0 && (
        <div className="border-t border-rule px-4 py-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-4">Sources</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {docRows.map((e) => (
              <div key={e.source.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="font-mono text-[9px] text-accent">{e.document.kind === "pdf" ? "PDF" : "DOC"}</span>
                  <span className="truncate text-[12px] text-ink-2">{e.document.title}</span>
                </span>
                <span className="shrink-0 text-[10px] text-ink-4">
                  {PROCESSING.has(e.document.status)
                    ? "indexing…"
                    : e.document.status === "failed"
                      ? "failed"
                      : "indexed"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.facets.length > 0 && (
        <div className="border-t border-rule px-4 py-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-4">Interview</div>
          <div className="mt-2 flex flex-col gap-2">
            {s.facets.map((f, i) => (
              <div key={i}>
                <div className="text-[10px] text-ink-4">{f.label}</div>
                <div className="text-[12.5px] text-ink-2">{f.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.summary && (
        <div className="border-t border-rule px-4 py-3 text-[12.5px] leading-relaxed text-ink-3">{s.summary}</div>
      )}
    </div>
  );
}
