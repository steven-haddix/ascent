//! BYO API-key storage in the OS keychain (macOS Keychain via the `keyring` crate).
//!
//! The raw key is intentionally NOT exposed to the webview: JS can set it, check
//! whether one exists, and delete it — but never read it back. The AI transport
//! command reads it here in Rust and injects it into model requests, so the key
//! never enters the JS / devtools layer.

use keyring::Entry;

const SERVICE: &str = "ascent";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// Store (or replace) a secret under `account`.
#[tauri::command]
pub fn set_secret(account: String, value: String) -> Result<(), String> {
    entry(&account)?.set_password(&value).map_err(|e| e.to_string())
}

/// Whether a secret exists for `account`. Does NOT return the value.
#[tauri::command]
pub fn has_secret(account: String) -> Result<bool, String> {
    match entry(&account)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove a secret. Succeeds even if none was stored.
#[tauri::command]
pub fn delete_secret(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Rust-internal read, used by the AI transport command. Never exposed to JS.
pub(crate) fn read_secret(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Hits the real login keychain. Promptless for our own service items, but
    // requires an accessible keychain session — so it's opt-in (run with
    // `cargo test -- --ignored`) and kept out of the default headless run.
    #[test]
    #[ignore = "requires an interactive macOS login keychain"]
    fn set_has_delete_roundtrip() {
        let acct = "ascent-selftest-key";
        set_secret(acct.into(), "sk-test-123".into()).unwrap();
        assert!(has_secret(acct.into()).unwrap());
        delete_secret(acct.into()).unwrap();
        assert!(!has_secret(acct.into()).unwrap());
    }
}
