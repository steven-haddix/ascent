import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.5;

interface Point {
  x: number;
  y: number;
}

export interface ImageView {
  scale: number;
  x: number;
  y: number;
}

const INITIAL_VIEW: ImageView = { scale: MIN_SCALE, x: 0, y: 0 };

export function clampImageScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/** Keep the point beneath the cursor stationary while the image scales around it. */
export function zoomImageAt(view: ImageView, nextScale: number, point: Point): ImageView {
  const scale = clampImageScale(nextScale);
  if (scale === MIN_SCALE) return INITIAL_VIEW;
  const ratio = scale / view.scale;
  return {
    scale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ZoomableImage({
  src,
  alt,
  title,
  caption,
  className,
}: {
  src: string;
  alt: string;
  title: string;
  caption?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${title} in image viewer`}
        className="group relative mx-auto block cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <img src={src} alt={alt} draggable={false} className={className} />
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-1 font-sans text-[9.5px] uppercase tracking-wider text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Expand
        </span>
      </button>
      {open && <ImageViewer src={src} alt={alt} title={title} caption={caption} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageViewer({
  src,
  alt,
  title,
  caption,
  onClose,
}: {
  src: string;
  alt: string;
  title: string;
  caption?: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setViewState] = useState<ImageView>(INITIAL_VIEW);
  const viewRef = useRef<ImageView>(INITIAL_VIEW);
  const pointersRef = useRef(new Map<number, Point>());
  const dragRef = useRef<{ pointerId: number; point: Point; view: ImageView } | null>(null);
  const pinchRef = useRef<{ distance: number; midpoint: Point; view: ImageView } | null>(null);

  const clampView = (candidate: ImageView): ImageView => {
    const scale = clampImageScale(candidate.scale);
    if (scale === MIN_SCALE) return INITIAL_VIEW;
    const image = imageRef.current;
    if (!image) return { ...candidate, scale };
    const maxX = (image.clientWidth * (scale - 1)) / 2;
    const maxY = (image.clientHeight * (scale - 1)) / 2;
    return {
      scale,
      x: Math.max(-maxX, Math.min(maxX, candidate.x)),
      y: Math.max(-maxY, Math.min(maxY, candidate.y)),
    };
  };

  const setView = (candidate: ImageView) => {
    const next = clampView(candidate);
    viewRef.current = next;
    setViewState(next);
  };

  const pointFromClient = (clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const zoomBy = (amount: number, point: Point = { x: 0, y: 0 }) => {
    const current = viewRef.current;
    setView(zoomImageAt(current, current.scale + amount, point));
  };

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [],
        );
        if (focusable.length === 0) return;
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (current <= 0 ? focusable.length - 1 : current - 1)
          : (current + 1) % focusable.length;
        focusable[next].focus();
      } else if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
      else if (event.key === "-") zoomBy(-ZOOM_STEP);
      else if (event.key === "0") setView(INITIAL_VIEW);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = pointFromClient(event.clientX, event.clientY);
      const amount = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      zoomBy(amount, point);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const beginPinch = () => {
    const points = Array.from(pointersRef.current.values());
    if (points.length < 2) return;
    pinchRef.current = { distance: distance(points[0], points[1]), midpoint: midpoint(points[0], points[1]), view: viewRef.current };
    dragRef.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromClient(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2) beginPinch();
    else dragRef.current = { pointerId: event.pointerId, point, view: viewRef.current };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = pointFromClient(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);

    if (pointersRef.current.size >= 2) {
      if (!pinchRef.current) beginPinch();
      const pinch = pinchRef.current;
      const points = Array.from(pointersRef.current.values());
      if (!pinch || points.length < 2 || pinch.distance === 0) return;
      const currentMidpoint = midpoint(points[0], points[1]);
      const scale = pinch.view.scale * (distance(points[0], points[1]) / pinch.distance);
      const zoomed = zoomImageAt(pinch.view, scale, pinch.midpoint);
      setView({
        ...zoomed,
        x: zoomed.x + currentMidpoint.x - pinch.midpoint.x,
        y: zoomed.y + currentMidpoint.y - pinch.midpoint.y,
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.view.scale <= MIN_SCALE) return;
    setView({
      ...drag.view,
      x: drag.view.x + point.x - drag.point.x,
      y: drag.view.y + point.y - drag.point.y,
    });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pinchRef.current = null;
    const remaining = Array.from(pointersRef.current.entries())[0];
    dragRef.current = remaining
      ? { pointerId: remaining[0], point: remaining[1], view: viewRef.current }
      : null;
  };

  const viewer = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 font-sans backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(94vh,920px)] w-[min(96vw,1440px)] flex-col overflow-hidden rounded-lg border border-rule bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-rule bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <div id={titleId} className="truncate text-[13px] font-medium text-ink">{title}</div>
            <div className="text-[9.5px] uppercase tracking-wider text-ink-3">Drag to pan · wheel or pinch to zoom</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out" className="rounded border border-rule px-2 py-1 text-xs text-ink-2 hover:bg-surface disabled:opacity-35">−</button>
            <button type="button" onClick={() => setView(INITIAL_VIEW)} className="min-w-12 rounded border border-rule px-2 py-1 font-mono text-[10.5px] text-ink-2 hover:bg-surface" aria-label="Reset zoom">{Math.round(view.scale * 100)}%</button>
            <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in" className="rounded border border-rule px-2 py-1 text-xs text-ink-2 hover:bg-surface disabled:opacity-35">+</button>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close image viewer" className="ml-1 rounded border border-rule px-2 py-1 text-xs text-ink-2 hover:bg-surface hover:text-ink">✕</button>
          </div>
        </div>
        <div
          ref={stageRef}
          className={`flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden bg-surface-2/40 ${view.scale > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onDoubleClick={(event) => {
            const point = pointFromClient(event.clientX, event.clientY);
            setView(viewRef.current.scale > MIN_SCALE ? INITIAL_VIEW : zoomImageAt(viewRef.current, 2, point));
          }}
        >
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            draggable={false}
            className="max-h-full max-w-full object-contain will-change-transform"
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
          />
        </div>
        {caption && <div className="shrink-0 border-t border-rule px-3 py-2 text-center text-[11px] text-ink-3">{caption}</div>}
      </div>
    </div>
  );

  return createPortal(viewer, document.body);
}
