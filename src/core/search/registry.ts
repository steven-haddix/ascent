// Web search provider registry + feature gate (spec §1). Mirrors media/registry.ts: enabled
// provider ids live in localStorage; secrets live in the Keychain (`provider:<id>`). Web search is
// its OWN capability layer — NOT a member of AiCapability (which is model capability). The native
// provider is enabled by default because it's keyless (it reuses the LLM route's key).
import type { AnySearchProvider } from "./types";
import { isNative } from "./types";
import { isWebSearchEnabled } from "../settings";
import { tavily } from "./providers/tavily";
import { anthropicNative } from "./providers/anthropicNative";

const registered = new Map<string, AnySearchProvider>();

const ENABLED_KEY = "ascent-search-providers"; // JSON string[] of enabled provider ids
const DEFAULT_ENABLED = ["anthropic-native"]; // keyless default — usable whenever an Anthropic route is active

function enabledIds(): string[] {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ENABLED_KEY) : null;
  if (!raw) return DEFAULT_ENABLED;
  try {
    const ids = JSON.parse(raw) as string[];
    return Array.isArray(ids) ? ids : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

export function isSearchProviderEnabled(id: string): boolean {
  return enabledIds().includes(id);
}

export function setSearchProviderEnabled(id: string, on: boolean): void {
  const next = new Set(enabledIds());
  if (on) next.add(id);
  else next.delete(id);
  localStorage.setItem(ENABLED_KEY, JSON.stringify([...next]));
}

export const searchProviderRegistry = {
  register: (p: AnySearchProvider) => registered.set(p.id, p),
  get: (id: string) => registered.get(id),
  list: (): AnySearchProvider[] => [...registered.values()],
  /** enabled providers; native further requires its route to actually support it. */
  enabled: (): AnySearchProvider[] =>
    [...registered.values()].filter((p) => isSearchProviderEnabled(p.id) && (isNative(p) ? p.isAvailable() : true)),
};

// Register built-in providers.
searchProviderRegistry.register(anthropicNative);
searchProviderRegistry.register(tavily);

/** Feature gate (§1): the master switch is on AND some enabled provider is actually usable.
 *  Drives grounding (returns "" when false) and the resources lens (hidden when false). Sync +
 *  cheap (no network, no Keychain) so it's safe on the render path. */
export function hasSearchCapability(): boolean {
  if (!isWebSearchEnabled()) return false;
  return searchProviderRegistry.enabled().length > 0;
}
