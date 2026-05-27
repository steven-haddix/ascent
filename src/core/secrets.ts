// Frontend wrapper over the Rust keychain commands. The raw key is write-only
// from JS: we can set it, check it exists, or clear it — never read it back.
import { invoke } from "@tauri-apps/api/core";

const ANTHROPIC_KEY = "anthropic-api-key";

export const secretStore = {
  hasApiKey: () => invoke<boolean>("has_secret", { account: ANTHROPIC_KEY }),
  setApiKey: (value: string) => invoke<void>("set_secret", { account: ANTHROPIC_KEY, value }),
  clearApiKey: () => invoke<void>("delete_secret", { account: ANTHROPIC_KEY }),
};
