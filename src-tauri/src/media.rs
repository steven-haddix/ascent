// Generic provider executor (Visual §6d + Continuity A6). Two Tauri commands that run a
// request descriptor the TS adapters build — knowing NOTHING provider-specific. They
// inject the descriptor's named Keychain secret (`provider:<id>`) as a Bearer token, the
// same auth-in-Rust boundary as ai_request, so keys never enter JS. Used by media search/
// fetch AND embeddings. Adding a provider is a pure-TS adapter — zero changes here.
use crate::http::http;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

/// How the Keychain secret is injected (spec §3). Absent on a Descriptor = `bearer` (today's
/// behavior), so existing media/embeddings descriptors are unchanged.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSpec {
    /// "bearer" | "header" | "query"
    scheme: String,
    /// header name (e.g. X-Subscription-Token) or query-param key (e.g. api_key)
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    secret_account: Option<String>,
    /// secret injection scheme; absent = bearer.
    #[serde(default)]
    auth: Option<AuthSpec>,
    /// per-request timeout in ms; absent = no extra timeout (only the client connect-timeout).
    #[serde(default)]
    timeout_ms: Option<u64>,
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

/// Build a reqwest request from a descriptor. Rust unconditionally owns auth: it strips any
/// client-supplied auth header (the standard ones plus a configured custom header name) and injects
/// the Keychain secret per the descriptor's `auth` scheme — bearer (default), an arbitrary header,
/// or a URL query param. The key never enters JS (spec §3).
fn build(d: &Descriptor) -> Result<reqwest::RequestBuilder, String> {
    let method = reqwest::Method::from_bytes(d.method.as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;

    let scheme = d.auth.as_ref().map(|a| a.scheme.as_str()).unwrap_or("bearer");
    let auth_name = d.auth.as_ref().and_then(|a| a.name.as_ref());

    // Read the secret once (used by whichever scheme applies).
    let key = match &d.secret_account {
        Some(account) => crate::secrets::read_secret(account)?,
        None => None,
    };

    // For the `query` scheme, append the secret to the URL (properly encoded) before building.
    let mut url = d.url.clone();
    if scheme == "query" {
        if let (Some(k), Some(name)) = (key.as_ref(), auth_name) {
            let mut parsed = reqwest::Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
            parsed.query_pairs_mut().append_pair(name, k);
            url = parsed.to_string();
        }
    }

    let mut req = http().request(method, &url);

    // The configured custom header name we must NOT trust from the client (avoids reqwest
    // appending a duplicate of an injected header).
    let custom_header_lower = if scheme == "header" {
        auth_name.map(|n| n.to_ascii_lowercase())
    } else {
        None
    };
    for (k, v) in &d.headers {
        let lower = k.to_ascii_lowercase();
        if lower == "authorization" || lower == "x-api-key" {
            continue; // never trust a client-supplied auth header
        }
        if custom_header_lower.as_deref() == Some(lower.as_str()) {
            continue;
        }
        req = req.header(k, v);
    }

    // Inject the secret per scheme (query already folded into the URL above).
    if let Some(k) = key.as_ref() {
        match scheme {
            "header" => {
                if let Some(name) = auth_name {
                    req = req.header(name.as_str(), k);
                }
            }
            "query" => {}
            _ => {
                req = req.header("authorization", format!("Bearer {k}"));
            }
        }
    }

    if let Some(ms) = d.timeout_ms {
        req = req.timeout(std::time::Duration::from_millis(ms));
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

/// Decode provider-returned base64 image bytes into the same local media cache
/// used by downloaded assets. `cache_key` is app-generated metadata, never a path.
#[tauri::command]
pub fn cache_generated_asset(
    app: tauri::AppHandle,
    data: String,
    content_type: String,
    cache_key: String,
) -> Result<DownloadedAsset, String> {
    if !content_type.to_ascii_lowercase().starts_with("image/") {
        return Err("generated asset must have an image content type".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("invalid generated image data: {e}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("generated image exceeds the 25 MB cache limit".to_string());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{:x}.{}", hash_str(&cache_key), ext_for(&content_type));
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
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
