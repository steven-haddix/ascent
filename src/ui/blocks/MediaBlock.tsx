import { useEffect, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Block } from "../../core/types";
import { useMedia } from "../../core/store/hooks";
import { resumeMediaJobIfStuck } from "../../core/generation/mediaJobs";
import { CollapsibleBlockCard } from "./CollapsibleBlockCard";
import { ZoomableImage } from "./ZoomableImage";

// Renders a provider-sourced media asset (image v1). The block is a placeholder; a job
// (mediaJobs) resolves + caches the bytes and writes a media_assets row, which this joins
// by (conceptId, mediaId). Images load from the local cache via Tauri's asset protocol —
// never a remote URL. Visible attribution is rendered wherever a licensed asset appears (§6e).
export function MediaBlock({
  block,
  conceptId,
  presentation = "inline",
}: {
  block: Block;
  conceptId?: string;
  presentation?: "inline" | "gallery";
}) {
  const mediaId = block.mediaId ?? null;
  const q = useMedia(conceptId ?? null, mediaId);
  const row = q.data;

  useEffect(() => {
    if (row) resumeMediaJobIfStuck(row);
  }, [row]);

  if (!mediaId || !conceptId) return null;

  const title = block.title?.trim() || row?.attribution?.title?.trim() || block.purpose?.trim() || "Image";
  const status = row?.status ?? "generating";
  const meta =
    status === "ready" ? "image · click to expand" : status === "failed" ? "image · unavailable" : "image · finding…";

  let content: ReactNode;

  if (!row || row.status === "generating") {
    content = (
      <div className="grid h-44 place-items-center font-sans text-[12px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Finding an image{block.purpose ? ` — ${block.purpose}` : ""}…
        </span>
      </div>
    );
  } else if (row.status === "failed" || !row.localPath) {
    // Offline-graceful: the prose stands alone; show the intent rather than a broken frame.
    content = (
      <div className="p-4 text-center font-sans text-[12px] text-ink-3">
        {block.alt || block.purpose || "Image unavailable."}
      </div>
    );
  } else {
    const src = convertFileSrc(row.localPath);
    const attr = row.attribution;
    const lic = row.license;
    const attribution = (attr?.author || lic?.name) ? (
      <>
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
      </>
    ) : null;

    content = (
      <figure className="m-0 px-3 pb-2 pt-3 font-sans">
        <ZoomableImage
          src={src}
          alt={block.alt || block.purpose || attr?.title || ""}
          title={title}
          caption={attribution}
          className="max-h-[440px] w-auto rounded-md border border-rule"
        />
        {attribution && <figcaption className="mt-1.5 text-center text-[11px] text-ink-3">{attribution}</figcaption>}
      </figure>
    );
  }

  if (presentation === "gallery") {
    return (
      <div className="my-6">
        {!block.title?.trim() && (
          <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{title}</div>
        )}
        {content}
      </div>
    );
  }

  return (
    <CollapsibleBlockCard title={title} meta={meta}>
      {content}
    </CollapsibleBlockCard>
  );
}
