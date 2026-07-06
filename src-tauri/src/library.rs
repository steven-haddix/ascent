// Knowledge-library blob storage (knowledge-backbone plan §5). Three commands:
//
//   library_fetch        GET a public http(s) URL and store the bytes durably
//   library_store_bytes  store user-uploaded bytes (from a webview file input)
//   library_delete_blob  remove a blob once its last DB binding is gone
//
// Blobs live under app_DATA_dir/library/blobs/<sha256> — deliberately NOT the
// cache dir media.rs uses: the OS may purge caches, and the library is "provenance,
// forever". The name is the content hash (no extension); MIME lives in the DB row.
//
// The fetch path is hardened beyond media.rs because K4 auto-ingest will fetch URLs
// no human clicked: scheme allow-list, loopback/private-address guard (initial URL
// resolved via DNS; every redirect hop re-checked syntactically), redirect limit,
// size cap enforced while streaming, and MIME sniffing from magic bytes.
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;

const MAX_BYTES_DEFAULT: u64 = 50 * 1024 * 1024; // 50 MB
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REDIRECTS: usize = 5;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBlob {
    pub content_hash: String,
    pub local_path: String,
    pub mime: String,
    pub byte_size: u64,
    /// the URL that actually served the bytes (after redirects); null for uploads
    pub final_url: Option<String>,
}

/// Is this IP one we refuse to fetch from? (loopback, private, link-local, ULA, unspecified)
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // CGNAT 100.64.0.0/10 (Tailscale et al.)
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // fc00::/7 unique-local + fe80::/10 link-local
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// Syntactic host check (no DNS): rejects http(s)-less schemes, localhost, and
/// private-range IP literals. Used on the initial URL AND on every redirect hop.
fn guard_host_syntactic(url: &reqwest::Url) -> Result<(), String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(format!("refusing non-http(s) URL scheme '{}'", url.scheme()));
    }
    match url.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            if d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local") {
                return Err("refusing local hostname".into());
            }
        }
        Some(url::Host::Ipv4(ip)) => {
            if is_private_ip(&IpAddr::V4(ip)) {
                return Err("refusing private-network address".into());
            }
        }
        Some(url::Host::Ipv6(ip)) => {
            if is_private_ip(&IpAddr::V6(ip)) {
                return Err("refusing private-network address".into());
            }
        }
        None => return Err("URL has no host".into()),
    }
    Ok(())
}

/// Full guard for the initial URL: syntactic + resolve the hostname and check
/// every A/AAAA answer against the private ranges.
async fn guard_url(raw: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw).map_err(|e| format!("bad url: {e}"))?;
    guard_host_syntactic(&parsed)?;
    if let Some(url::Host::Domain(domain)) = parsed.host() {
        let port = parsed.port_or_known_default().unwrap_or(443);
        let addrs = tokio::net::lookup_host((domain, port))
            .await
            .map_err(|e| format!("cannot resolve host: {e}"))?;
        for addr in addrs {
            if is_private_ip(&addr.ip()) {
                return Err("host resolves to a private-network address".into());
            }
        }
    }
    Ok(parsed)
}

/// Dedicated client: bounded redirects with a per-hop host guard. Separate from the
/// shared http() client so provider requests keep their existing redirect behavior.
fn library_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > MAX_REDIRECTS {
                    return attempt.error("too many redirects");
                }
                match guard_host_syntactic(attempt.url()) {
                    Ok(()) => attempt.follow(),
                    Err(_) => attempt.error("redirect to a disallowed address"),
                }
            }))
            .build()
            .expect("failed to build library client")
    })
}

/// Sniff a MIME type from magic bytes, falling back to the served content-type.
fn sniff_mime(bytes: &[u8], served: Option<&str>) -> String {
    if bytes.starts_with(b"%PDF-") {
        return "application/pdf".into();
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
    if head.contains("<html") || head.contains("<!doctype html") {
        return "text/html".into();
    }
    if let Some(ct) = served {
        // strip parameters ("text/html; charset=utf-8" → "text/html")
        if let Some(base) = ct.split(';').next() {
            let base = base.trim();
            if !base.is_empty() {
                return base.to_ascii_lowercase();
            }
        }
    }
    "application/octet-stream".into()
}

fn blobs_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library")
        .join("blobs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn store_bytes(app: &tauri::AppHandle, bytes: &[u8], served_mime: Option<&str>, final_url: Option<String>) -> Result<StoredBlob, String> {
    let hash: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    let dir = blobs_dir(app)?;
    let path = dir.join(&hash);
    if !path.exists() {
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(StoredBlob {
        content_hash: hash,
        local_path: path.to_string_lossy().to_string(),
        mime: sniff_mime(bytes, served_mime),
        byte_size: bytes.len() as u64,
        final_url,
    })
}

/// Fetch a public URL into the library blob store. No secrets are ever attached —
/// library documents are public web content, unlike provider descriptors.
#[tauri::command]
pub async fn library_fetch(
    app: tauri::AppHandle,
    url: String,
    max_bytes: Option<u64>,
) -> Result<StoredBlob, String> {
    let cap = max_bytes.unwrap_or(MAX_BYTES_DEFAULT).min(MAX_BYTES_DEFAULT);
    let parsed = guard_url(&url).await?;

    let resp = library_client()
        .get(parsed)
        .header("user-agent", "ascent-library/0.1 (+https://github.com/steven-haddix/ascent)")
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("fetch failed: HTTP {}", resp.status()));
    }
    // Early reject on declared length, then enforce the cap for real while streaming.
    if let Some(len) = resp.content_length() {
        if len > cap {
            return Err(format!("document is {len} bytes; the library cap is {cap}"));
        }
    }
    let served_mime = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let final_url = resp.url().to_string();

    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() as u64 + chunk.len() as u64 > cap {
            return Err(format!("document exceeds the {cap}-byte library cap"));
        }
        bytes.extend_from_slice(&chunk);
    }

    store_bytes(&app, &bytes, served_mime.as_deref(), Some(final_url))
}

/// Store user-uploaded bytes (base64 from a webview file input) into the blob store.
#[tauri::command]
pub fn library_store_bytes(
    app: tauri::AppHandle,
    data: String,
    declared_mime: Option<String>,
) -> Result<StoredBlob, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("invalid upload data: {e}"))?;
    if bytes.len() as u64 > MAX_BYTES_DEFAULT {
        return Err(format!("upload exceeds the {MAX_BYTES_DEFAULT}-byte library cap"));
    }
    store_bytes(&app, &bytes, declared_mime.as_deref(), None)
}

/// Delete a blob by content hash (called when the last DB binding is removed).
#[tauri::command]
pub fn library_delete_blob(app: tauri::AppHandle, content_hash: String) -> Result<(), String> {
    // The hash IS the filename — reject anything that isn't a bare sha256 hex string.
    if content_hash.len() != 64 || !content_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid content hash".into());
    }
    let path = blobs_dir(&app)?.join(content_hash.to_ascii_lowercase());
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Read a stored blob back for extraction (webview needs the bytes; the asset
/// protocol is scoped to media). Returns base64.
#[tauri::command]
pub fn library_read_blob(app: tauri::AppHandle, content_hash: String) -> Result<String, String> {
    use base64::Engine;
    if content_hash.len() != 64 || !content_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid content hash".into());
    }
    let path = blobs_dir(&app)?.join(content_hash.to_ascii_lowercase());
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_hosts_are_rejected_syntactically() {
        for bad in [
            "http://localhost/x",
            "http://127.0.0.1/x",
            "http://10.0.0.5/x",
            "http://192.168.1.1/x",
            "http://172.16.0.9/x",
            "http://169.254.169.254/latest/meta-data",
            "http://100.100.1.1/x",
            "http://[::1]/x",
            "http://[fe80::1]/x",
            "http://foo.local/x",
            "ftp://example.com/x",
            "file:///etc/passwd",
        ] {
            let parsed = reqwest::Url::parse(bad);
            let verdict = parsed.map(|u| guard_host_syntactic(&u));
            assert!(
                !matches!(verdict, Ok(Ok(()))),
                "{bad} should have been rejected"
            );
        }
        let ok = reqwest::Url::parse("https://arxiv.org/pdf/1706.03762").unwrap();
        assert!(guard_host_syntactic(&ok).is_ok());
    }

    #[test]
    fn mime_sniffing() {
        assert_eq!(sniff_mime(b"%PDF-1.7 ...", Some("text/plain")), "application/pdf");
        assert_eq!(sniff_mime(b"<!DOCTYPE html><html>", None), "text/html");
        assert_eq!(sniff_mime(b"# markdown", Some("text/markdown; charset=utf-8")), "text/markdown");
        assert_eq!(sniff_mime(b"\x00\x01", None), "application/octet-stream");
    }
}
