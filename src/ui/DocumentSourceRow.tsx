/* Hallmark · component: document source row · genre: editorial · theme: existing Ascent tokens
 * pre-emit critique: P5 H5 E5 S5 R5 V5 · states: default · hover · focus · active · disabled · loading · error · success
 */
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

export function documentMarker(mime: string | null, kind: string): string {
  if (mime === "application/pdf") return "PDF";
  return kind === "web" ? "WEB" : "DOC";
}

export function DocumentSourceRow({
  marker,
  title,
  url,
  detail,
  badge,
  actions,
}: {
  marker: string;
  title: string;
  url?: string | null;
  detail: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-md border border-rule bg-surface px-3 py-2">
      <span className="w-8 shrink-0 font-mono text-[9px] uppercase text-accent">{marker}</span>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => (url ? void openUrl(url) : undefined)}
          disabled={!url}
          className="block max-w-full text-left active:text-ink-2 disabled:cursor-default focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className={`block truncate text-[13px] text-ink ${url ? "group-hover:text-accent" : ""}`}>
            {title}
          </span>
        </button>
        <div className="mt-0.5 truncate text-[11px] text-ink-4">{detail}</div>
      </div>
      {badge ? (
        <span className="max-w-28 shrink-0 truncate rounded-full border border-rule px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {badge}
        </span>
      ) : null}
      {actions}
    </div>
  );
}
