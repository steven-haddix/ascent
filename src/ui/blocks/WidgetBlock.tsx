// Inline interactive widget card. The block is only a placeholder (title +
// spec); the payload lives in the widgets table and is rendered inside a
// sandboxed srcdoc iframe (opaque origin — no Tauri IPC, no app storage;
// postMessage is the only channel). States: generating → skeleton with the
// spec, ready → live sandbox, failed → spec + error + Retry.
import { useEffect, useRef, useState } from "react";
import type { Block } from "../../core/types";
import { useWidget } from "../../core/store/hooks";
import {
  reportWidgetRenderFailure,
  retryWidget,
  resumeWidgetJobIfStuck,
} from "../../core/generation/widgetJobs";
import { loadWidgetRuntime, buildWidgetSrcdoc, readWidgetTokens, readColorScheme } from "./widgetFrame";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;
const DEFAULT_HEIGHT = 240;

export function WidgetBlock({
  block,
  conceptId,
  conceptTitle,
  widgetKey,
}: {
  block: Block;
  conceptId: string;
  conceptTitle: string;
  widgetKey: string;
}) {
  const { data: widget } = useWidget(conceptId, widgetKey);
  const [expanded, setExpanded] = useState(true);

  // Self-heal a row left `generating` by a previous session (app quit mid-build).
  useEffect(() => {
    if (widget) resumeWidgetJobIfStuck(widget, conceptTitle);
  }, [widget, conceptTitle]);

  const title = widget?.title ?? block.title ?? "Interactive widget";
  const status = widget?.status ?? "generating";
  const meta =
    status === "ready" ? "interactive" : status === "failed" ? "interactive · failed" : "interactive · building…";

  return (
    <div data-find-ignore className="my-5 overflow-hidden rounded-md border border-rule">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-3 bg-surface-2 px-3 py-1.5 text-left font-sans ${
          expanded ? "border-b border-rule" : ""
        }`}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[12.5px] font-medium text-ink-2">{title}</span>
          <span className="text-[9.5px] uppercase tracking-wider text-ink-3">{meta}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10.5px] uppercase tracking-wider text-ink-3">
          {expanded ? "Hide" : "Show"}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
          >
            <path d="M2 3.5 L5 6.5 L8 3.5" />
          </svg>
        </span>
      </button>

      {expanded && (
        <>
          {status === "generating" && (
            <div className="px-4 py-3.5 font-sans">
              <p className="text-[12.5px] leading-snug text-ink-3">{widget?.spec ?? block.spec}</p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                Building this interactive…
              </div>
            </div>
          )}

          {status === "failed" && widget && (
            <div className="px-4 py-3.5 font-sans">
              <p className="text-[12.5px] leading-snug text-ink-3">{widget.spec}</p>
              {widget.error && <p className="mt-2 text-[11.5px] text-red-600">{widget.error}</p>}
              <button
                onClick={() => retryWidget(widget, conceptTitle)}
                className="mt-2.5 rounded-md bg-ink px-3 py-1 text-xs font-medium text-surface hover:bg-accent"
              >
                Retry
              </button>
            </div>
          )}

          {status === "ready" && widget?.compiled && (
            <WidgetFrame
              // updatedAt key: regenerated source gets a fresh frame, never a stale runtime state
              key={widget.updatedAt}
              compiled={widget.compiled}
              onRenderError={(message) =>
                void reportWidgetRenderFailure(conceptId, conceptTitle, widgetKey, message, widget.updatedAt)
              }
            />
          )}
        </>
      )}
    </div>
  );
}

/** The sandbox host. Protocol with the runtime (widget-runtime/runtime.ts):
 *  child posts `ready` → we post `render` (compiled + theme tokens) → child posts
 *  `rendered`/`resize` (height) or `error`. Theme switches re-send `render` so a
 *  mounted widget restyles live. */
function WidgetFrame({
  compiled,
  onRenderError,
}: {
  compiled: string;
  onRenderError: (message: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  // Keep the latest handler without re-wiring the message listener.
  const onErrorRef = useRef(onRenderError);
  onErrorRef.current = onRenderError;

  useEffect(() => {
    let alive = true;
    loadWidgetRuntime()
      .then((rt) => alive && setSrcdoc(buildWidgetSrcdoc(rt, readWidgetTokens(), readColorScheme())))
      .catch((err) => alive && setSetupError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!srcdoc) return;
    const send = () => {
      frameRef.current?.contentWindow?.postMessage(
        { type: "ascent:render", compiled, tokens: readWidgetTokens(), colorScheme: readColorScheme() },
        "*",
      );
    };
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const m = e.data as { type?: string; message?: string; height?: number };
      if (m?.type === "ascent:ready") {
        readyRef.current = true;
        send();
      } else if (m?.type === "ascent:rendered" || m?.type === "ascent:resize") {
        if (typeof m.height === "number" && m.height > 0) {
          setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(m.height))));
        }
      } else if (m?.type === "ascent:error") {
        onErrorRef.current(String(m.message ?? "widget failed"));
      }
    };
    window.addEventListener("message", onMessage);
    // Theme switch (data-theme / .dark on <html>) → re-send tokens to a live frame.
    const observer = new MutationObserver(() => {
      if (readyRef.current) send();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [srcdoc, compiled]);

  if (setupError) {
    return <p className="px-4 py-3.5 font-sans text-[11.5px] text-red-600">{setupError}</p>;
  }
  if (!srcdoc) {
    return (
      <div className="flex items-center gap-2 px-4 py-3.5 font-sans text-[11px] text-ink-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Loading sandbox…
      </div>
    );
  }
  return (
    <iframe
      ref={frameRef}
      title="Interactive widget"
      // allow-scripts WITHOUT allow-same-origin: opaque origin — the sandbox
      // boundary that keeps generated code away from Tauri IPC. Do not widen.
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      className="block w-full border-0 bg-surface"
      style={{ height }}
    />
  );
}
