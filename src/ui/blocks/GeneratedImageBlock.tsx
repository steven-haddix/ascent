import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resumeGeneratedImageJobIfStuck } from "../../core/generation/generatedImageJobs";
import { useMedia } from "../../core/store/hooks";
import type { Block } from "../../core/types";

export function GeneratedImageBlock({ block, conceptId }: { block: Block; conceptId?: string }) {
  const mediaId = block.mediaId ?? null;
  const row = useMedia(conceptId ?? null, mediaId).data;

  useEffect(() => {
    if (row) resumeGeneratedImageJobIfStuck(row);
  }, [row]);

  if (!mediaId || !conceptId) return null;
  if (!row || row.status === "generating") {
    return (
      <div className="my-6 grid h-52 place-items-center rounded-md border border-dashed border-rule font-sans text-[12px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Generating an illustration{block.purpose ? ` — ${block.purpose}` : ""}…
        </span>
      </div>
    );
  }
  if (row.status === "failed" || !row.localPath) {
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        {block.alt || block.purpose || "Generated illustration unavailable."}
      </div>
    );
  }

  return (
    <figure className="my-6 font-sans">
      <img
        src={convertFileSrc(row.localPath)}
        alt={block.alt || block.purpose || ""}
        className="mx-auto max-h-[480px] w-auto rounded-md border border-rule"
      />
      <figcaption className="mt-1.5 text-center text-[11px] text-ink-3">
        AI-generated illustration{row.attribution?.author ? ` · ${row.attribution.author}` : ""} · may contain inaccuracies
      </figcaption>
    </figure>
  );
}
