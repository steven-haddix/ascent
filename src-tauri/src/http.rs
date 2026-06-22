// Shared HTTP client for the generic provider executor (media + embeddings). A separate
// OnceLock client from ai.rs's (kept independent so the proven ai_request/ai_stream path
// is untouched); same 15s connect-timeout discipline.
use std::sync::OnceLock;
use std::time::Duration;

pub(crate) fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build reqwest client")
    })
}
