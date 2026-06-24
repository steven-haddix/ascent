import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resourcesRepo, type ResourceRow } from "../../core/store/repositories";
import { refreshResources } from "../../core/generation/resourceJobs";
import { isLessonStreaming } from "../../core/generation/lessonStreams";
import { hasSearchCapability } from "../../core/search/registry";
import { isWebSearchEnabled } from "../../core/settings";
import type { SearchKind } from "../../core/search/types";
import type { LensProps } from "./types";

// Render order for the kind groups (web-search spec §7).
const GROUPS: { kind: SearchKind; label: string }[] = [
  { kind: "paper", label: "Papers" },
  { kind: "video", label: "Videos" },
  { kind: "blog", label: "Blogs" },
  { kind: "docs", label: "Docs" },
  { kind: "web", label: "Web" },
];

/** The Resources ("Continue learning") lens: a concept's web-search resources, grouped by kind, each
 *  opening in the external browser (never embedded). The tab is appended by PreviewPane only when
 *  resources exist or a search is in flight — it is NOT declared by the lesson generator. */
export function ResourcesLens({ concept, ctx }: LensProps) {
  const q = useQuery({
    queryKey: ["resources", concept.id],
    queryFn: async () => (await resourcesRepo.listByConcept(concept.id)) as ResourceRow[],
  });
  const [refreshing, setRefreshing] = useState(false);

  const rows = (q.data ?? []).filter((r) => r.status === "ready");
  const searching = refreshing || (isLessonStreaming(concept.id) && hasSearchCapability());

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshResources(concept, ctx);
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        {searching ? (
          <>
            <p className="text-sm text-ink-2">Searching the web…</p>
            <p className="max-w-[30ch] text-[12px] text-ink-3">
              Gathering current papers, videos, and articles for this concept.
            </p>
          </>
        ) : isWebSearchEnabled() ? (
          <>
            <p className="text-sm text-ink-2">No web resources yet.</p>
            <button
              onClick={onRefresh}
              className="rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-surface hover:bg-accent"
            >
              Find resources
            </button>
          </>
        ) : (
          <p className="max-w-[30ch] text-[12px] text-ink-3">
            Turn on Web search in Settings → Sources to gather external resources for this concept.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-ink-3">Current sources for continued learning. Links open in your browser.</p>
        <button onClick={onRefresh} disabled={searching} className="shrink-0 text-[12px] text-accent disabled:opacity-40">
          {searching ? "Refreshing…" : "Refresh latest"}
        </button>
      </div>
      {GROUPS.map(({ kind, label }) => {
        const items = rows.filter((r) => r.kind === kind);
        if (!items.length) return null;
        return (
          <section key={kind}>
            <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-ink-4">{label}</div>
            <div className="flex flex-col gap-1.5">
              {items.map((r) => (
                <button
                  key={r.url}
                  onClick={() => void openUrl(r.url)}
                  className="group rounded-md border border-rule bg-surface px-3 py-2 text-left transition-colors hover:border-accent"
                >
                  <span className="block text-[13px] font-medium text-ink group-hover:text-accent">{r.title}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-4">
                    {r.source ?? ""}
                    {r.publishedAt ? ` · ${r.publishedAt}` : ""}
                  </span>
                  {r.snippet ? <span className="mt-1 block text-[12px] leading-snug text-ink-3">{r.snippet}</span> : null}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
