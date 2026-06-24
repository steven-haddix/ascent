import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { hasSearchCapability, searchProviderRegistry, setSearchProviderEnabled, isSearchProviderEnabled } from "./registry";
import { setWebSearchEnabled } from "../settings";

function stubLocalStorage() {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("web search capability gating", () => {
  beforeEach(stubLocalStorage);
  afterEach(() => {
    // @ts-expect-error reset
    delete globalThis.localStorage;
  });

  it("native is enabled by default and lights up the capability on an Anthropic route", () => {
    expect(isSearchProviderEnabled("anthropic-native")).toBe(true);
    expect(hasSearchCapability()).toBe(true);
  });

  it("the master kill-switch disables the whole feature regardless of providers", () => {
    setWebSearchEnabled(false);
    expect(hasSearchCapability()).toBe(false);
  });

  it("disabling the only usable provider makes the feature dormant", () => {
    setSearchProviderEnabled("anthropic-native", false);
    expect(hasSearchCapability()).toBe(false); // tavily not enabled by default
  });

  it("an enabled standalone provider lights the feature up even without native", () => {
    setSearchProviderEnabled("anthropic-native", false);
    setSearchProviderEnabled("tavily", true);
    expect(hasSearchCapability()).toBe(true);
    expect(searchProviderRegistry.enabled().map((p) => p.id)).toContain("tavily");
  });

  it("registry lists the built-in providers", () => {
    expect(searchProviderRegistry.list().map((p) => p.id)).toEqual(expect.arrayContaining(["anthropic-native", "tavily"]));
  });
});
