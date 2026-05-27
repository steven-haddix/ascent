//! AI request transport. The webview's AI SDK calls these through an injected
//! fetch; we read the BYO key from the keychain and attach it HERE, so the key
//! never lives in the JS/devtools layer (this also sidesteps webview CORS).
//!
//! - `ai_request`: non-streaming (generateText / Output.object) — full response.
//! - `ai_stream`:  streaming (streamText) — response body is forwarded chunk by
//!   chunk (base64) over a Tauri Channel; the JS shim rebuilds a streaming
//!   Response from it. Bytes are base64'd (not decoded to text in Rust) so a
//!   multi-byte UTF-8 char split across network chunks survives intact.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use std::collections::HashMap;
use tauri::ipc::Channel;

/// Build a reqwest request with the BYO key injected from the keychain.
/// Any client-supplied auth header is dropped (we own auth).
fn build_request(
    method: &str,
    url: &str,
    headers: &HashMap<String, String>,
    body: Option<String>,
) -> Result<reqwest::RequestBuilder, String> {
    let key = crate::secrets::read_secret("anthropic-api-key")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No API key configured".to_string())?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut b = reqwest::Client::new().request(method, url);
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("x-api-key") || k.eq_ignore_ascii_case("authorization") {
            continue;
        }
        b = b.header(k, v);
    }
    b = b.header("x-api-key", key);
    if let Some(body) = body {
        b = b.body(body);
    }
    Ok(b)
}

fn collect_headers(resp: &reqwest::Response) -> HashMap<String, String> {
    let mut h = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(s) = v.to_str() {
            h.insert(k.as_str().to_string(), s.to_string());
        }
    }
    h
}

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
    let resp = build_request(&method, &url, &headers, body)?
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = collect_headers(&resp);
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(AiResponse { status, headers, body })
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum StreamMsg {
    Chunk { data: String }, // base64 of the raw body bytes
    Done,
    Error { message: String },
}

#[derive(serde::Serialize)]
pub struct StreamHead {
    status: u16,
    headers: HashMap<String, String>,
}

#[tauri::command]
pub async fn ai_stream(
    channel: Channel<StreamMsg>,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<StreamHead, String> {
    let resp = build_request(&method, &url, &headers, body)?
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = collect_headers(&resp);

    // Stream the body back over the channel after returning the response head,
    // so the JS shim can build a streaming Response immediately.
    tauri::async_runtime::spawn(async move {
        let mut stream = resp.bytes_stream();
        while let Some(item) = stream.next().await {
            match item {
                Ok(bytes) => {
                    let _ = channel.send(StreamMsg::Chunk {
                        data: STANDARD.encode(&bytes),
                    });
                }
                Err(e) => {
                    let _ = channel.send(StreamMsg::Error {
                        message: e.to_string(),
                    });
                    return;
                }
            }
        }
        let _ = channel.send(StreamMsg::Done);
    });

    Ok(StreamHead { status, headers })
}
