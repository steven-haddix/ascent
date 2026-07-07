import type { PdfLine, PdfLocalPage, PdfTextItem } from "./types";

const SAME_LINE_TOLERANCE = 2.5;

function itemHeight(item: PdfTextItem): number {
  return Math.abs(item.height || item.transform[3] || 10);
}

function itemX(item: PdfTextItem): number {
  return item.transform[4] ?? 0;
}

function itemY(item: PdfTextItem): number {
  return item.transform[5] ?? 0;
}

function shouldInsertSpace(previous: PdfTextItem, current: PdfTextItem): boolean {
  if (/\s$/.test(previous.str) || /^\s/.test(current.str)) return false;
  const averageGlyph = previous.str.trim().length
    ? Math.abs(previous.width) / previous.str.trim().length
    : itemHeight(previous) * 0.45;
  const gap = itemX(current) - (itemX(previous) + previous.width);
  // Adjacent font runs often split a word (drop caps, bold spans, ligatures).
  // A real word boundary normally leaves a visibly larger glyph-space.
  return gap > Math.max(0.8, averageGlyph * 0.22);
}

function finishLine(items: PdfTextItem[], breakAfter: boolean): PdfLine | null {
  if (!items.length) return null;
  let text = items[0].str;
  for (let i = 1; i < items.length; i++) {
    if (shouldInsertSpace(items[i - 1], items[i])) text += " ";
    text += items[i].str;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const first = items[0];
  const last = items[items.length - 1];
  return {
    text,
    x: itemX(first),
    endX: itemX(last) + last.width,
    y: itemY(first),
    height: Math.max(...items.map(itemHeight)),
    breakAfter,
  };
}

/** Reconstruct logical lines while preserving PDF content-stream reading order. */
export function linesFromItems(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let current: PdfTextItem[] = [];
  let baseline: number | null = null;

  const flush = (breakAfter: boolean) => {
    const line = finishLine(current, breakAfter);
    if (line) lines.push(line);
    current = [];
    baseline = null;
  };

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) flush(true);
      continue;
    }
    const y = itemY(item);
    if (baseline !== null && Math.abs(y - baseline) > Math.max(SAME_LINE_TOLERANCE, itemHeight(item) * 0.3)) {
      flush(true);
    }
    current.push(item);
    baseline ??= y;
    if (item.hasEOL) flush(true);
  }
  flush(false);
  return lines;
}

/**
 * Repair the uncommon PDFs whose content stream alternates left/right lines.
 * Most PDFs already expose logical column order, so this only activates when
 * geometry has two strong clusters AND the observed order repeatedly crosses.
 */
export function repairInterleavedColumns(lines: PdfLine[], pageWidth: number): PdfLine[] {
  const narrow = lines.filter((line) => line.endX - line.x < pageWidth * 0.65);
  if (narrow.length < 8) return lines;
  const xs = narrow.map((line) => line.x).sort((a, b) => a - b);
  let split: number | null = null;
  let largestGap = 0;
  for (let i = 3; i < xs.length - 3; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > pageWidth * 0.12 && gap > largestGap) {
      largestGap = gap;
      split = (xs[i] + xs[i - 1]) / 2;
    }
  }
  if (split === null) return lines;

  const sequence = narrow.map((line) => (line.x < split! ? "left" : "right"));
  let switches = 0;
  for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) switches++;
  if (switches < Math.max(4, narrow.length * 0.25)) return lines;

  const left = narrow.filter((line) => line.x < split!);
  const right = narrow.filter((line) => line.x >= split!);
  if (left.length < 4 || right.length < 4) return lines;
  const maxColumnY = Math.max(...narrow.map((line) => line.y));
  const minColumnY = Math.min(...narrow.map((line) => line.y));
  const spanning = lines.filter((line) => line.endX - line.x >= pageWidth * 0.65);
  // A full-width figure/table in the middle divides the page into regions; leave
  // that harder layout untouched for PDF.js order (or hybrid vision) to avoid loss.
  if (spanning.some((line) => line.y < maxColumnY && line.y > minColumnY)) return lines;

  const byReadingPosition = (a: PdfLine, b: PdfLine) => b.y - a.y || a.x - b.x;
  const before = spanning.filter((line) => line.y >= maxColumnY).sort(byReadingPosition);
  const after = spanning.filter((line) => line.y <= minColumnY).sort(byReadingPosition);
  return [...before, ...left.sort(byReadingPosition), ...right.sort(byReadingPosition), ...after];
}

/** Convert cleaned layout lines to retrieval text without preserving soft wraps. */
export function textFromLines(lines: PdfLine[]): string {
  let text = "";
  for (const line of lines) {
    if (!text) {
      text = line.text;
      continue;
    }
    const leftFragment = /([\p{L}]+)-$/u.exec(text)?.[1] ?? "";
    const rightFragment = /^([\p{Ll}]+)/u.exec(line.text)?.[1] ?? "";
    // Short fragments are strong evidence of a word split (adap-/tive). For
    // longer fragments, preserve the hyphen: false negatives are preferable to
    // corrupting genuine compounds such as novelty-detection.
    if (leftFragment && rightFragment && (leftFragment.length <= 5 || rightFragment.length <= 4)) {
      text = text.slice(0, -1) + line.text;
    } else if (/\p{L}-$/u.test(text) && /^\p{L}/u.test(line.text)) {
      // Preserve a real compound hyphen while removing only the soft line wrap.
      text += line.text;
    } else {
      text += `\n${line.text}`;
    }
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function withPageText(page: PdfLocalPage, lines: PdfLine[]): PdfLocalPage {
  return { ...page, lines, text: textFromLines(lines) };
}
