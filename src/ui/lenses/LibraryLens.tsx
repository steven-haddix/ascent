import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sourceRepo, topicRepo, type LibraryEntry } from "../../core/store/repositories";
import { reextractDocument, removeSource, retryDocument, saveUploadToLibrary, setSourcePinned } from "../../core/knowledge/ingest";
import { supportedMime } from "../../core/knowledge/extract/registry";
import { DocumentSourceRow, documentMarker } from "../DocumentSourceRow";
import type { LensProps } from "./types";

const ROLE_LABEL: Record<string, string> = {
  syllabus: "Syllabus",
  "ground-truth": "Ground truth",
  reference: "Reference",
};

/** Mid-pipeline phases all read as "Processing" — the exact phase is a tooltip detail. */
const PROCESSING = new Set(["queued", "fetching", "extracting", "chunking", "indexing"]);

function DocumentStatus({ entry }: { entry: LibraryEntry }) {
  const { document } = entry;
  if (PROCESSING.has(document.status)) return <span className="text-ink-3">Indexing…</span>;
  if (document.status === "failed") {
    return (
      <span className="text-danger">
        Couldn't read this file{" "}
        <button
          onClick={() => void retryDocument(document.id)}
          className="text-accent hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          retry
        </button>
      </span>
    );
  }
  return (
    <span title={document.error ?? undefined}>
      {document.error ? "Using previous extraction" : "✓ Indexed · ready to cite"}
      {document.meta?.domain ? ` · ${document.meta.domain}` : ""}
      {document.mime === "application/pdf" ? (
        <>
          {" · "}
          <button
            onClick={() => void reextractDocument(document.id)}
            className="text-ink-3 hover:text-accent hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
          >
            re-extract
          </button>
        </>
      ) : null}
    </span>
  );
}

/** The topic's knowledge library: durable expert sources (saved search results +
 *  uploaded documents) that ground every lesson in this topic. Always offered. */
export function LibraryLens({ concept }: LensProps) {
  const topicId = concept.topicId;
  const q = useQuery({
    queryKey: ["library", topicId],
    queryFn: () => sourceRepo.listByTopic(topicId),
  });
  // The topic brief's permanent home (topic-creation design): its facets +
  // grounded-in live as a header above the source list.
  const topic = useQuery({ queryKey: ["topic", topicId], queryFn: () => topicRepo.get(topicId) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const entries = q.data ?? [];
  const brief = topic.data?.brief;

  const onUpload = async (files: FileList | null) => {
    setUploadError(null);
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = file.type || (/\.(md|markdown)$/i.test(file.name) ? "text/markdown" : "text/plain");
        if (!supportedMime(mime)) throw new Error(`unsupported file type: ${file.name}`);
        await saveUploadToLibrary(
          { name: file.name, bytes, mime },
          { scope: "topic", topicId, kind: mime === "application/pdf" ? "pdf" : "notes" },
        );
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err));
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-ink-3">
          This topic's expert sources. Lessons draw on them and cite what they use.
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-surface hover:bg-accent"
        >
          Add document
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => void onUpload(e.target.files)}
        />
      </div>
      {uploadError ? <p className="text-[11.5px] text-danger">{uploadError}</p> : null}

      {brief?.facets && brief.facets.length > 0 && (
        <div className="rounded-lg border border-rule bg-bg px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-4">Topic brief</div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {brief.facets.map((f, i) => (
              <div key={i} className="text-[11.5px]">
                <span className="text-ink-4">{f.label}: </span>
                <span className="text-ink-2">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-sm text-ink-2">The library is empty.</p>
          <p className="max-w-[34ch] text-[12px] text-ink-3">
            Save sources from a concept's Sources tab, or add a PDF / markdown / text document —
            every lesson in this topic can then build on it.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <DocumentSourceRow
              key={e.source.id}
              marker={documentMarker(e.document.mime, e.document.kind)}
              title={e.document.title}
              url={e.document.url}
              detail={<DocumentStatus entry={e} />}
              badge={ROLE_LABEL[e.source.role] ?? e.source.role}
              actions={
                <>
                  <button
                    title={e.source.pinned ? "Unpin" : "Pin (always retrieved first)"}
                    onClick={() => void setSourcePinned(e.source.id, !e.source.pinned)}
                    className={`shrink-0 text-[13px] active:text-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent ${
                      e.source.pinned ? "text-accent" : "text-ink-4 hover:text-ink-2"
                    }`}
                  >
                    {e.source.pinned ? "★" : "☆"}
                  </button>
                  <button
                    title="Remove from library"
                    onClick={() => void removeSource(e.source.id)}
                    className="shrink-0 text-[13px] text-ink-4 hover:text-danger active:text-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    ✕
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
