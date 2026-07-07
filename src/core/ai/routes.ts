// Provider/route registry — the seam that lets the same model be reached through
// different providers/gateways (Anthropic direct today; Anthropic-via-OpenRouter
// or a gateway later). A "route" bundles everything that differs by provider:
// which runtime adapter builds the model, which Keychain key + auth header to use, the base
// URL, the selectable models, and how cost is determined (computed from a rate
// table vs. read from gateway-reported metadata).
//
// Dependency-free (like models.ts) so settings/pricing can import it without a
// cycle. Provider adapters own model construction; service.ts supplies the
// Rust-bound fetch. This file is pure route metadata.
import { MODELS, MODEL_OPTIONS } from "./models";

/** A selectable model on a route. The id is a plain string because a gateway has
 *  its own id namespace (e.g. "anthropic/claude-opus-4-7"), unlike the Anthropic
 *  catalog's narrow ModelId union. Anthropic's MODEL_OPTIONS satisfy this shape. */
export interface RouteModel {
  id: string;
  label: string;
  blurb: string;
  capabilities: Array<"textGeneration" | "vision">;
}

/** How Rust injects the BYO key for this route. */
export type AuthScheme = "x-api-key" | "bearer";

/** How a route's cost is determined. */
export type CostMode = "rates" | "reported";

/** USD per 1,000,000 tokens. `cachedInput` defaults to `input * 0.1` (the cache-read rate). */
export interface ModelRates {
  input: number;
  output: number;
  cachedInput?: number;
}

export interface Route {
  id: string;
  label: string;
  /** Runtime adapter that owns model construction and provider-specific settings. */
  adapterId: string;
  /** Keychain account holding this route's key (see secrets.ts). */
  secretName: string;
  /** How Rust attaches the key to outgoing requests. */
  authScheme: AuthScheme;
  /** Override base URL for gateways; undefined = the SDK's provider default. */
  baseURL?: string;
  /** Selectable models, most → least capable. */
  models: RouteModel[];
  /** Fallback model when none is chosen or the chosen id isn't valid for this route. */
  defaultModelId: string;
  costMode: CostMode;
  /** Per-model rates (USD / 1M tokens) — used when costMode === "rates". */
  rates?: Record<string, ModelRates>;
  /** Read a USD cost from the provider's response metadata — used when costMode
   *  === "reported" (gateways that bill and report a dollar amount). */
  extractReportedCost?: (providerMetadata: unknown) => number | null;
  /** Structurally defined but not yet runtime-verified — hidden from the picker. */
  experimental?: boolean;
}

// Anthropic API list prices, USD per 1M tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-07-06).
// cachedInput = the "Cache Hits & Refreshes" (0.1x base input) rate.
const SONNET_5_RATES: ModelRates = Date.now() < Date.UTC(2026, 8, 1)
  ? { input: 2, output: 10, cachedInput: 0.2 }
  : { input: 3, output: 15, cachedInput: 0.3 };

const ANTHROPIC_RATES: Record<string, ModelRates> = {
  [MODELS.flagship]: { input: 5, output: 25, cachedInput: 0.5 }, // Opus 4.8
  [MODELS.flagshipPrev]: { input: 5, output: 25, cachedInput: 0.5 }, // Opus 4.7
  [MODELS.sonnetLatest]: SONNET_5_RATES, // Introductory pricing ends 2026-08-31.
  [MODELS.default]: { input: 3, output: 15, cachedInput: 0.3 }, // Sonnet 4.6
  [MODELS.fast]: { input: 1, output: 5, cachedInput: 0.1 }, // Haiku 4.5
};

const anthropic: Route = {
  id: "anthropic",
  label: "Anthropic",
  adapterId: "anthropic",
  secretName: "anthropic-api-key",
  authScheme: "x-api-key",
  models: MODEL_OPTIONS,
  defaultModelId: MODELS.default,
  costMode: "rates",
  rates: ANTHROPIC_RATES,
};

/** Safely read a nested numeric `cost` from arbitrary providerMetadata. */
function readNumber(obj: unknown, ...path: string[]): number | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

// EXAMPLE route (not active). Demonstrates the seam: reaching Anthropic models
// THROUGH OpenRouter. OpenRouter returns an actual dollar cost in providerMetadata
// (when usage accounting is enabled), so costMode is "reported" with the rate table
// kept only as a fallback. To activate: register an OpenRouter text adapter,
// store an "openrouter-api-key" in the Keychain, flip `experimental` off, and
// verify with a runnable spike.
const openrouter: Route = {
  id: "openrouter",
  label: "OpenRouter",
  adapterId: "openrouter",
  secretName: "openrouter-api-key",
  authScheme: "bearer",
  baseURL: "https://openrouter.ai/api/v1",
  models: [
    { id: "anthropic/claude-opus-4-8", label: "Opus 4.8 (via OpenRouter)", blurb: "Newest, most capable.", capabilities: ["textGeneration", "vision"] },
    { id: "anthropic/claude-opus-4-7", label: "Opus 4.7 (via OpenRouter)", blurb: "Previous flagship.", capabilities: ["textGeneration", "vision"] },
    { id: "anthropic/claude-sonnet-5", label: "Sonnet 5 (via OpenRouter)", blurb: "Newest Sonnet.", capabilities: ["textGeneration", "vision"] },
    { id: "anthropic/claude-sonnet-4-6", label: "Sonnet 4.6 (via OpenRouter)", blurb: "Balanced default.", capabilities: ["textGeneration", "vision"] },
    { id: "anthropic/claude-haiku-4-5", label: "Haiku 4.5 (via OpenRouter)", blurb: "Fastest & cheapest.", capabilities: ["textGeneration", "vision"] },
  ],
  defaultModelId: "anthropic/claude-sonnet-4-6",
  costMode: "reported",
  extractReportedCost: (pm) => readNumber(pm, "openrouter", "usage", "cost"),
  rates: {
    "anthropic/claude-opus-4-8": { input: 5, output: 25, cachedInput: 0.5 },
    "anthropic/claude-opus-4-7": { input: 5, output: 25, cachedInput: 0.5 },
    "anthropic/claude-sonnet-5": SONNET_5_RATES,
    "anthropic/claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3 },
    "anthropic/claude-haiku-4-5": { input: 1, output: 5, cachedInput: 0.1 },
  },
  experimental: true,
};

export const ROUTES: Record<string, Route> = { anthropic, openrouter };

export const DEFAULT_ROUTE_ID = anthropic.id;

/** Resolve a route id to its config, falling back to the default route. */
export function getRoute(id: string): Route {
  return ROUTES[id] ?? ROUTES[DEFAULT_ROUTE_ID];
}

/** Routes a user can actually pick today (verified, non-experimental). */
export const ROUTE_OPTIONS: Route[] = Object.values(ROUTES).filter((r) => !r.experimental);
