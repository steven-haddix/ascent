// Media provider registry + enabled-state (Visual §6b). The set of enabled providers
// and their non-secret options live in localStorage; secrets live in the Keychain via
// secretStore keyed `provider:<id>`. v1 ships Wikimedia (image, no key) enabled by default.
import type { MediaKind, MediaProviderMeta } from "./types";
import { geminiImages } from "./providers/geminiImages";
import { openaiImages } from "./providers/openaiImages";
import { wikimedia } from "./providers/wikimedia";

const registered = new Map<string, MediaProviderMeta>();

const ENABLED_KEY = "ascent-media-providers"; // JSON string[] of enabled provider ids
const DEFAULT_ENABLED = ["wikimedia"]; // keyless, safe to enable out of the box

function enabledIds(): string[] {
  const storage = typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" ? localStorage : null;
  const raw = storage?.getItem(ENABLED_KEY) ?? null;
  if (!raw) return DEFAULT_ENABLED;
  try {
    const ids = JSON.parse(raw) as string[];
    return Array.isArray(ids) ? ids : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

export function isMediaProviderEnabled(id: string): boolean {
  return enabledIds().includes(id);
}

export function setMediaProviderEnabled(id: string, on: boolean): void {
  const next = new Set(enabledIds());
  if (on) next.add(id);
  else next.delete(id);
  localStorage.setItem(ENABLED_KEY, JSON.stringify([...next]));
}

export const mediaProviderRegistry = {
  register: (p: MediaProviderMeta) => registered.set(p.id, p),
  get: (id: string) => registered.get(id),
  list: (): MediaProviderMeta[] => [...registered.values()],
  providersFor: (kind: MediaKind): MediaProviderMeta[] =>
    [...registered.values()].filter((p) => p.kinds.includes(kind)),
  /** enabled + (if needsKey) keyed providers for a kind — the resolvable set. */
  enabled: (): MediaProviderMeta[] => [...registered.values()].filter((p) => isMediaProviderEnabled(p.id)),
};

// Register built-in providers.
mediaProviderRegistry.register(wikimedia);
mediaProviderRegistry.register(openaiImages);
mediaProviderRegistry.register(geminiImages);
