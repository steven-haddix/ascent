// The model catalog — kept dependency-free so both the AI service and the
// settings layer can import it without a cycle (service ↔ settings). Model IDs
// are mid-2026 (see the design spec). Default is Sonnet; the user overrides in
// Settings, resolved per task via getModelFor().
export const MODELS = {
  flagship: "claude-opus-4-8",
  flagshipPrev: "claude-opus-4-7",
  sonnetLatest: "claude-sonnet-5",
  default: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5-20251001",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export interface ModelOption {
  id: ModelId;
  label: string;
  blurb: string;
  capabilities: Array<"textGeneration" | "vision">;
}

/** User-facing model choices for the Settings picker, ordered most → least capable. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: MODELS.flagship, label: "Opus 4.8", blurb: "Newest, most capable — best lessons & grading. Slower, priciest.", capabilities: ["textGeneration", "vision"] },
  { id: MODELS.flagshipPrev, label: "Opus 4.7", blurb: "Previous flagship — top-tier quality.", capabilities: ["textGeneration", "vision"] },
  { id: MODELS.sonnetLatest, label: "Sonnet 5", blurb: "Newest Sonnet — stronger reasoning with balanced speed and cost.", capabilities: ["textGeneration", "vision"] },
  { id: MODELS.default, label: "Sonnet 4.6", blurb: "Balanced default — strong quality, good speed.", capabilities: ["textGeneration", "vision"] },
  { id: MODELS.fast, label: "Haiku 4.5", blurb: "Fastest & cheapest — lighter quality; great for quick drafts.", capabilities: ["textGeneration", "vision"] },
];
