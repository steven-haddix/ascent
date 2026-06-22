// Generic provider executor (Visual §6d + Continuity A6). Two Tauri commands that run a
// request descriptor the TS adapters build — knowing NOTHING provider-specific. They
// inject the descriptor's named Keychain secret (`provider:<id>`) as a Bearer token, the
// same auth-in-Rust boundary as ai_request, so keys never enter JS. Used by media search/
// fetch AND embeddings. Adding a provider is a pure-TS adapter — zero changes here.
use crate::http::http;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    secret_account: Option<String>,
}

#[derive(Serialize)]
pub struct ProviderResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedAsset {
    local_path: String,
    content_type: String,
    width: Option<u32>,
    height: Option<u32>,
}

/// Build a reqwest request from a descriptor. Strips any client-supplied auth header
/// (Rust unconditionally owns auth) and injects the Keychain secret as a Bearer token.
fn build(d: &Descriptor) -> Result<reqwest::RequestBuilder, String> {
    let method = reqwest::Method::from_bytes(d.method.as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let mut req = http().request(method, &d.url);
    for (k, v) in &d.headers {
        let lower = k.to_ascii_lowercase();
        if lower == "authorization" || lower == "x-api-key" {
            continue; // never trust a client-supplied auth header
        }
        req = req.header(k, v);
    }
    if let Some(account) = &d.secret_account {
        if let Some(key) = crate::secrets::read_secret(account)? {
            req = req.header("authorization", format!("Bearer {key}"));
        }
    }
    if let Some(body) = &d.body {
        req = req.body(body.clone());
    }
    Ok(req)
}

#[tauri::command]
pub async fn provider_request(descriptor: Descriptor) -> Result<ProviderResponse, String> {
    let resp = build(&descriptor)?
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(s) = v.to_str() {
            headers.insert(k.as_str().to_string(), s.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(ProviderResponse { status, headers, body })
}

#[tauri::command]
pub async fn provider_download(
    app: tauri::AppHandle,
    descriptor: Descriptor,
) -> Result<DownloadedAsset, String> {
    let resp = build(&descriptor)?
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{:x}.{}", hash_str(&descriptor.url), ext_for(&content_type));
    let path = dir.join(&name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    Ok(DownloadedAsset {
        local_path: path.to_string_lossy().to_string(),
        content_type,
        width: None,
        height: None,
    })
}

fn hash_str(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

fn ext_for(content_type: &str) -> &'static str {
    let c = content_type.to_ascii_lowercase();
    if c.contains("jpeg") || c.contains("jpg") {
        "jpg"
    } else if c.contains("png") {
        "png"
    } else if c.contains("svg") {
        "svg"
    } else if c.contains("gif") {
        "gif"
    } else if c.contains("webp") {
        "webp"
    } else {
        "bin"
    }
}
