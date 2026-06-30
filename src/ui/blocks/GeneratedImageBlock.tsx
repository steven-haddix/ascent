import { useEffect, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resumeGeneratedImageJobIfStuck } from "../../core/generation/generatedImageJobs";
import { useMedia } from "../../core/store/hooks";
import type { Block } from "../../core/types";
import { CollapsibleBlockCard } from "./CollapsibleBlockCard";
import { ZoomableImage } from "./ZoomableImage";

export function GeneratedImageBlock({
  block,
  conceptId,
  presentation = "inline",
}: {
  block: Block;
  conceptId?: string;
  presentation?: "inline" | "gallery";
}) {
  const mediaId = block.mediaId ?? null;
  const row = useMedia(conceptId ?? null, mediaId).data;

  useEffect(() => {
    if (row) resumeGeneratedImageJobIfStuck(row);
  }, [row]);

  if (!mediaId || !conceptId) return null;

  const title = block.title?.trim() || block.purpose?.trim() || "Generated illustration";
  const status = row?.status ?? "generating";
  const meta =
    status === "ready"
      ? "AI illustration · click to expand"
      : status === "failed"
        ? "AI illustration · unavailable"
        : "AI illustration · generating…";
  let content: ReactNode;

  if (!row || row.status === "generating") {
    content = (
      <div className="grid h-52 place-items-center font-sans text-[12px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Generating an illustration{block.purpose ? ` — ${block.purpose}` : ""}…
        </span>
      </div>
    );
  } else if (row.status === "failed" || !row.localPath) {
    content = (
      <div className="p-4 text-center font-sans text-[12px] text-ink-3">
        {block.alt || block.purpose || "Generated illustration unavailable."}
      </div>
    );
  } else {
    const caption = (
      <>AI-generated illustration{row.attribution?.author ? ` · ${row.attribution.author}` : ""} · may contain inaccuracies</>
    );
    content = (
      <figure className="m-0 px-3 pb-2 pt-3 font-sans">
        <ZoomableImage
          src={convertFileSrc(row.localPath)}
          alt={block.alt || block.purpose || ""}
          title={title}
          caption={caption}
          className="max-h-[480px] w-auto rounded-md border border-rule"
        />
        <figcaption className="mt-1.5 text-center text-[11px] text-ink-3">{caption}</figcaption>
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
