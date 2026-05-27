//! AI request transport. The webview's AI SDK calls this through an injected
//! fetch; we read the BYO key from the keychain and attach it HERE, so the key
//! never lives in the JS/devtools layer. This also sidesteps webview CORS, since
//! the request originates from Rust.
//!
//! Non-streaming for now — enough for generateObject (topic outlines, grading).
//! Token streaming over a tauri::ipc::Channel lands in M3 for streamObject/
//! streamText (lesson bodies + chat).
use std::collections::HashMap;

#[derive(serde::Serialize)]
pub struct AiResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
pub async fn ai_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<AiResponse, String> {
    let key = crate::secrets::read_secret("anthropic-api-key")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No API key configured".to_string())?;

    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let client = reqwest::Client::new();
    let mut builder = client.request(method, &url);
    for (k, v) in &headers {
        // Drop any client-side auth header; we inject the real key from the keychain.
        if k.eq_ignore_ascii_case("x-api-key") || k.eq_ignore_ascii_case("authorization") {
            continue;
        }
        builder = builder.header(k, v);
    }
    builder = builder.header("x-api-key", key);
    if let Some(b) = body {
        builder = builder.body(b);
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let mut out_headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(s) = v.to_str() {
            out_headers.insert(k.as_str().to_string(), s.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(AiResponse {
        status,
        headers: out_headers,
        body,
    })
}
