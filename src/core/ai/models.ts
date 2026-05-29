// The model catalog — kept dependency-free so both the AI service and the
// settings layer can import it without a cycle (service ↔ settings). Model IDs
// are mid-2026 (see the design spec). Default is Sonnet; the user overrides in
// Settings, applied globally via getModel().
export const MODELS = {
  flagship: "claude-opus-4-8",
  flagshipPrev: "claude-opus-4-7",
  default: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5-20251001",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export interface ModelOption {
  id: ModelId;
  label: string;
  blurb: string;
}

/** User-facing model choices for the Settings picker, ordered most → least capable. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: MODELS.flagship, label: "Opus 4.8", blurb: "Newest, most capable — best lessons & grading. Slower, priciest." },
  { id: MODELS.flagshipPrev, label: "Opus 4.7", blurb: "Previous flagship — top-tier quality." },
  { id: MODELS.default, label: "Sonnet", blurb: "Balanced default — strong quality, good speed." },
  { id: MODELS.fast, label: "Haiku", blurb: "Fastest & cheapest — lighter quality; great for quick drafts." },
];
