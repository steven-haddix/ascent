// Frontend wrapper over the Rust keychain commands. The raw key is write-only
// from JS: we can set it, check it exists, or clear it — never read it back.
// Keyed by `secretName` (the active route's Keychain account, e.g.
// "anthropic-api-key" / "openrouter-api-key") so each provider keeps its own key.
import { invoke } from "@tauri-apps/api/core";

export const secretStore = {
  hasApiKey: (secretName: string) => invoke<boolean>("has_secret", { account: secretName }),
  setApiKey: (secretName: string, value: string) => invoke<void>("set_secret", { account: secretName, value }),
  clearApiKey: (secretName: string) => invoke<void>("delete_secret", { account: secretName }),
};
