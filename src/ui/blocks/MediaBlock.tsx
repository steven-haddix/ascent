import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Block } from "../../core/types";
import { useMedia } from "../../core/store/hooks";
import { resumeMediaJobIfStuck } from "../../core/generation/mediaJobs";

// Renders a provider-sourced media asset (image v1). The block is a placeholder; a job
// (mediaJobs) resolves + caches the bytes and writes a media_assets row, which this joins
// by (conceptId, mediaId). Images load from the local cache via Tauri's asset protocol —
// never a remote URL. Visible attribution is rendered wherever a licensed asset appears (§6e).
export function MediaBlock({ block, conceptId }: { block: Block; conceptId?: string }) {
  const mediaId = block.mediaId ?? null;
  const q = useMedia(conceptId ?? null, mediaId);
  const row = q.data;

  useEffect(() => {
    if (row) resumeMediaJobIfStuck(row);
  }, [row]);

  if (!mediaId || !conceptId) return null;

  if (!row || row.status === "generating") {
    return (
      <div className="my-6 grid h-44 place-items-center rounded-md border border-dashed border-rule font-sans text-[12px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Finding an image{block.purpose ? ` — ${block.purpose}` : ""}…
        </span>
      </div>
    );
  }
  if (row.status === "failed" || !row.localPath) {
    // Offline-graceful: the prose stands alone; show the intent rather than a broken frame.
    return (
      <div className="my-6 rounded-md border border-dashed border-rule p-4 text-center font-sans text-[12px] text-ink-3">
        {block.alt || block.purpose || "Image unavailable."}
      </div>
    );
  }

  const src = convertFileSrc(row.localPath);
  const attr = row.attribution;
  const lic = row.license;
  return (
    <figure className="my-6 font-sans">
      <img
        src={src}
        alt={block.alt || block.purpose || attr?.title || ""}
        className="mx-auto max-h-[440px] w-auto rounded-md border border-rule"
      />
      {(attr?.author || lic?.name) && (
        <figcaption className="mt-1.5 text-center text-[11px] text-ink-3">
          {attr?.author && <span>{attr.author}</span>}
          {attr?.author && lic?.name && <span> · </span>}
          {lic?.name &&
            (lic.url ? (
              <a href={lic.url} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">
                {lic.name}
              </a>
            ) : (
              <span>{lic.name}</span>
            ))}
          {attr?.sourceUrl && (
            <>
              {" · "}
              <a href={attr.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">
                source
              </a>
            </>
          )}
        </figcaption>
      )}
    </figure>
  );
}
