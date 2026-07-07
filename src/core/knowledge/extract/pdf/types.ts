export type PdfPageQualityLevel = "good" | "weak" | "empty";

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfLine {
  text: string;
  /** PDF-space baseline; origin is at the bottom-left. */
  y: number;
  x: number;
  endX: number;
  height: number;
  breakAfter: boolean;
}

export interface PdfPageStats {
  itemCount: number;
  singleCharacterItems: number;
  replacementCharacters: number;
  alphabeticCharacters: number;
}

export interface PdfLocalPage {
  page: number;
  width: number;
  height: number;
  lines: PdfLine[];
  text: string;
  stats: PdfPageStats;
}

export interface PdfPageQuality {
  level: PdfPageQualityLevel;
  reasons: string[];
}

export interface PdfExtractedPage {
  page: number;
  text: string;
  quality: PdfPageQuality;
  provenance: "pdfjs" | "vision";
  warnings: string[];
}

export interface PdfJsPageLike {
  streamTextContent(): ReadableStream<{ items: Array<Partial<PdfTextItem> & { str?: string }> }>;
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: {
    canvas?: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }): { promise: Promise<unknown> };
}

