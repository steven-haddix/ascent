import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resourcesRepo, sourceRepo, type ResourceRow } from "../../core/store/repositories";
import { saveUrlToLibrary } from "../../core/knowledge/ingest";
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

  // Library membership for the "Save" affordance: a resource counts as saved when a
  // library document carries its URL. (A redirect can change the stored URL — the
  // per-session `justSaved` set keeps the button honest for those.)
  const library = useQuery({
    queryKey: ["library", concept.topicId],
    queryFn: () => sourceRepo.listByTopic(concept.topicId),
  });
  const savedUrls = new Set((library.data ?? []).map((e) => e.document.url).filter(Boolean));
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSave = async (r: ResourceRow) => {
    if (saving) return;
    setSaving(r.url);
    setSaveError(null);
    try {
      await saveUrlToLibrary(r.url, {
        scope: "topic",
        topicId: concept.topicId,
        origin: "search",
        title: r.title,
        kind: r.kind,
        addedFromConceptId: concept.id,
      });
      setJustSaved((prev) => new Set(prev).add(r.url));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

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
      {saveError ? <p className="text-[11.5px] text-danger">Save failed: {saveError}</p> : null}
      {GROUPS.map(({ kind, label }) => {
        const items = rows.filter((r) => r.kind === kind);
        if (!items.length) return null;
        return (
          <section key={kind}>
            <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-ink-4">{label}</div>
            <div className="flex flex-col gap-1.5">
              {items.map((r) => {
                const saved = savedUrls.has(r.url) || justSaved.has(r.url);
                return (
                  <div
                    key={r.url}
                    className="group relative rounded-md border border-rule bg-surface px-3 py-2 text-left transition-colors hover:border-accent"
                  >
                    <button onClick={() => void openUrl(r.url)} className="block w-full text-left">
                      <span className="block pr-14 text-[13px] font-medium text-ink group-hover:text-accent">{r.title}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-4">
                        {r.source ?? ""}
                        {r.publishedAt ? ` · ${r.publishedAt}` : ""}
                      </span>
                      {r.snippet ? <span className="mt-1 block text-[12px] leading-snug text-ink-3">{r.snippet}</span> : null}
                    </button>
                    <button
                      title={saved ? "In this topic's library" : "Save to library — lessons will build on it"}
                      disabled={saved || saving === r.url}
                      onClick={() => void onSave(r)}
                      className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[11px] ${
                        saved ? "text-ink-4" : "text-accent hover:bg-rule"
                      } disabled:cursor-default`}
                    >
                      {saved ? "✓ Saved" : saving === r.url ? "Saving…" : "+ Save"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
