import { useCallback, useEffect, useRef, useState } from "react";
import { locateMatches, type MatchRange } from "./matching";

const HL_ALL = "lesson-find";
const HL_ACTIVE = "lesson-find-active";

/** True when the browser supports the CSS Custom Highlight API. When false we
 *  never intercept Ctrl+F, so the native browser find stays available. */
const SUPPORTED = typeof CSS !== "undefined" && "highlights" in CSS;

interface TextEntry {
  node: Text;
  start: number; // offset of this node's text within the concatenated string
}

/** Walk the visible text under `root` into one string plus an offset map back to
 *  the source text nodes. Skips anything inside [data-find-ignore] (the find bar,
 *  transient controls, NextSteps) and KaTeX internals (rendered glyphs + a hidden
 *  MathML mirror would match unreliably and double-count). */
function collectText(root: HTMLElement): { text: string; entries: TextEntry[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (el.closest("[data-find-ignore]") || el.closest(".katex")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = "";
  const entries: TextEntry[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    entries.push({ node: t, start: text.length });
    text += t.nodeValue;
  }
  return { text, entries };
}

/** The text node entry that contains global offset `pos`. */
function entryAt(entries: TextEntry[], pos: number): TextEntry | null {
  for (const e of entries) {
    if (pos >= e.start && pos < e.start + (e.node.nodeValue?.length ?? 0)) return e;
  }
  return null;
}

/** Build a DOM Range for a match. Ranges may span multiple text nodes (e.g. a word
 *  split by an inline term span), which the flat-string offsets handle for free. */
function buildRange(entries: TextEntry[], m: MatchRange): Range | null {
  const startEntry = entryAt(entries, m.start);
  const endEntry = entryAt(entries, m.end - 1); // last char's node; end is exclusive
  if (!startEntry || !endEntry) return null;
  const range = document.createRange();
  range.setStart(startEntry.node, m.start - startEntry.start);
  range.setEnd(endEntry.node, m.end - endEntry.start);
  return range;
}

export interface LessonFind {
  supported: boolean;
  isOpen: boolean;
  query: string;
  setQuery: (q: string) => void;
  matchCount: number;
  /** 0-based index of the current match, or -1 when there are none. */
  activeIndex: number;
  next: () => void;
  prev: () => void;
  close: () => void;
  /** Bumped each time Ctrl+F fires so the bar can (re)focus + select its input. */
  focusNonce: number;
}

/** Headless find-in-lesson controller. Owns the Ctrl+F shortcut, match state, and
 *  CSS Custom Highlight registration over the DOM under `containerRef`.
 *  `contentSignal` should change whenever the rendered lesson text changes so an
 *  open search recomputes (e.g. while a lesson streams in). */
export function useLessonFind(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  contentSignal: unknown,
): LessonFind {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focusNonce, setFocusNonce] = useState(0);
  const rangesRef = useRef<Range[]>([]);

  const clearHighlights = useCallback(() => {
    if (!SUPPORTED) return;
    CSS.highlights.delete(HL_ALL);
    CSS.highlights.delete(HL_ACTIVE);
    rangesRef.current = [];
  }, []);

  // Register the single active match (painted on top via priority) and scroll it
  // into the center of its scroll container.
  const applyActive = useCallback((index: number) => {
    if (!SUPPORTED) return;
    const range = rangesRef.current[index];
    if (!range) {
      CSS.highlights.delete(HL_ACTIVE);
      return;
    }
    const active = new Highlight(range);
    active.priority = 1;
    CSS.highlights.set(HL_ACTIVE, active);
    (range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, []);

  const recompute = useCallback(() => {
    if (!SUPPORTED) return;
    const root = containerRef.current;
    if (!root || !query.trim()) {
      clearHighlights();
      setMatchCount(0);
      setActiveIndex(-1);
      return;
    }
    const { text, entries } = collectText(root);
    const ranges = locateMatches(text, query)
      .map((m) => buildRange(entries, m))
      .filter((r): r is Range => r !== null);
    rangesRef.current = ranges;
    if (!ranges.length) {
      CSS.highlights.delete(HL_ALL);
      CSS.highlights.delete(HL_ACTIVE);
      setMatchCount(0);
      setActiveIndex(-1);
      return;
    }
    const all = new Highlight(...ranges);
    all.priority = 0;
    CSS.highlights.set(HL_ALL, all);
    setMatchCount(ranges.length);
    setActiveIndex(0);
    applyActive(0);
  }, [containerRef, query, clearHighlights, applyActive]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    clearHighlights();
    setMatchCount(0);
    setActiveIndex(-1);
  }, [clearHighlights]);

  const step = useCallback(
    (delta: number) => {
      const count = rangesRef.current.length;
      if (!count) return;
      setActiveIndex((i) => {
        const next = (i + delta + count) % count;
        applyActive(next);
        return next;
      });
    },
    [applyActive],
  );
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  // Ctrl+F / ⌘F opens the bar (and refocuses if already open). Only intercepted
  // when a lesson is mounted and the Highlight API is available — otherwise native
  // browser find is left untouched.
  useEffect(() => {
    if (!SUPPORTED || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsOpen(true);
        setFocusNonce((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  // Recompute when the query or the rendered content changes while open.
  useEffect(() => {
    if (!isOpen) return;
    recompute();
  }, [isOpen, query, contentSignal, recompute]);

  // Clear highlights on unmount (navigating to another concept remounts LessonPane).
  useEffect(() => clearHighlights, [clearHighlights]);

  return {
    supported: SUPPORTED,
    isOpen,
    query,
    setQuery,
    matchCount,
    activeIndex,
    next,
    prev,
    close,
    focusNonce,
  };
}
