//! Spike 2 (Rust side): prove `reqwest` streams an HTTP response body
//! incrementally — chunk-by-chunk as it arrives — rather than buffering the
//! whole thing. In the real app, a Tauri command will read the BYO key from the
//! Keychain, call the model API with reqwest, and forward these chunks over a
//! `tauri::ipc::Channel` to the webview, where the AI SDK's custom fetch
//! reassembles them (the JS half is proven in spikes/ai-stream.mjs).
//!
//! The actual streaming command lands in M1; this module just validates the
//! streaming primitive headlessly against a local chunked server.
#![allow(dead_code)]

#[cfg(test)]
mod tests {
    use futures_util::StreamExt;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    /// Minimal HTTP/1.1 server that sends a chunked body of `n` SSE-ish chunks,
    /// sleeping `delay_ms` between them so a streaming client sees them arrive
    /// progressively. Returns the bound port.
    fn spawn_chunked_server(n: usize, delay_ms: u64) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf); // consume request head (best-effort)
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\n\
                          Content-Type: text/event-stream\r\n\
                          Transfer-Encoding: chunked\r\n\r\n",
                    )
                    .unwrap();
                stream.flush().unwrap();
                for i in 0..n {
                    let payload = format!("data: chunk{i}\n\n");
                    let framed = format!("{:X}\r\n{}\r\n", payload.len(), payload);
                    stream.write_all(framed.as_bytes()).unwrap();
                    stream.flush().unwrap();
                    thread::sleep(Duration::from_millis(delay_ms));
                }
                stream.write_all(b"0\r\n\r\n").unwrap(); // terminating chunk
                stream.flush().unwrap();
            }
        });
        port
    }

    #[test]
    fn reqwest_streams_incrementally() {
        let n = 5;
        let port = spawn_chunked_server(n, 30);
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            let url = format!("http://127.0.0.1:{port}/");
            let resp = reqwest::get(&url).await.expect("request failed");
            assert_eq!(resp.status(), 200);

            let mut stream = resp.bytes_stream();
            let mut chunks = 0usize;
            let mut total = 0usize;
            while let Some(item) = stream.next().await {
                let bytes = item.expect("stream item error");
                total += bytes.len();
                chunks += 1;
            }
            // Multiple network reads = streamed, not one buffered blob.
            assert!(chunks >= 2, "expected multiple streamed chunks, got {chunks}");
            assert!(total > 0, "received no body bytes");
        });
    }
}
