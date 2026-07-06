import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { lessonRepo, resourcesRepo, type ConceptRow } from "../core/store/repositories";
import type { LensId } from "../core/types";
import { isLessonStreaming } from "../core/generation/lessonStreams";
import { hasSearchCapability } from "../core/search/registry";
import { getLens, getPreviewLenses } from "./lenses/registry";

/** The right pane: tabs for the lenses the current lesson declares (Notes /
 *  Quiz today). Reads the same cached lesson the center pane generated. */
export function PreviewPane({
  concept,
  concepts,
  ctx,
  onFork,
  onNavigate,
}: {
  concept: ConceptRow;
  concepts: ConceptRow[];
  ctx: { topicTitle: string; path: string[]; briefSummary?: string | null };
  onFork: (title: string, summary?: string, opts?: { remedial?: boolean }) => void;
  onNavigate: (conceptId: string) => void;
}) {
  // Shares the ["lesson", id] cache with the center pane — no extra fetch.
  const lesson = useQuery({
    queryKey: ["lesson", concept.id],
    queryFn: async () => (await lessonRepo.get(concept.id)) ?? null,
  });

  // Resources is DATA-DRIVEN (web-search spec §7): not declared by the generator, appended here when
  // web-search resources exist or a search is in flight. Shares the ["resources", id] cache with the lens.
  const resourceRows = useQuery({
    queryKey: ["resources", concept.id],
    queryFn: async () => await resourcesRepo.listByConcept(concept.id),
  });
  const showResources = (resourceRows.data?.length ?? 0) > 0 || (isLessonStreaming(concept.id) && hasSearchCapability());

  // Notes and Teach are core (subject-agnostic) — always offered. Quiz/Code arrive
  // from the lesson's declared lenses. Resources appended when present. Deduped, Notes first, Teach last.
  const fromLesson = (lesson.data?.lenses as LensId[] | undefined) ?? [];
  const declared = Array.from(
    new Set<LensId>(["notes", ...fromLesson, ...(showResources ? (["resources"] as LensId[]) : []), "library", "teach"]),
  );
  const lenses = getPreviewLenses(declared);
  const ids = lenses.map((l) => l.id).join(",");
  const [active, setActive] = useState<LensId>("notes");

  // Keep the active tab valid as declared lenses arrive (e.g. quiz after the lesson).
  useEffect(() => {
    if (!lenses.some((l) => l.id === active)) setActive(lenses[0]?.id ?? "notes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const Active = getLens(active);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-rule px-2">
        {lenses.map((l) => (
          <button
            key={l.id}
            onClick={() => setActive(l.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12px] font-medium ${
              active === l.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            <span className="font-mono text-[10.5px] text-ink-3">{l.icon}</span>
            {l.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {Active && (
          <Active.Renderer concept={concept} concepts={concepts} ctx={ctx} onFork={onFork} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}
