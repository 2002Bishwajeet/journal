//! Benchmark-only endpoints for the encryption spike (gate G7, #1245). They time
//! how fast database blocks cross from the web view to Rust: through the
//! commands below, and through `PUT`/`GET /__bench/blob` on the loopback asset
//! server. Compiled only with the `encfs-bench` feature. Never ship a build
//! with it.

use std::fs::{self, OpenOptions};
use std::io::{self, Cursor, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tiny_http::{Method, Response};

/// The file both paths write to, and the per-launch token the loopback
/// endpoint needs.
pub struct Bench {
    file: PathBuf,
    token: String,
}

impl Bench {
    /// `bench.bin` in `dir` (created), and a new token: 32 random bytes, hex.
    pub fn new(dir: PathBuf) -> io::Result<Bench> {
        fs::create_dir_all(&dir)?;
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
        Ok(Bench {
            file: dir.join("bench.bin"),
            token: bytes.iter().map(|b| format!("{b:02x}")).collect(),
        })
    }

    fn put(&self, bytes: &[u8]) -> io::Result<()> {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file)?
            .write_all(bytes)
    }

    /// Block `index` of `len` bytes: the bytes at `index * len`.
    fn get(&self, index: u32, len: u32) -> io::Result<Vec<u8>> {
        let mut file = fs::File::open(&self.file)?;
        file.seek(SeekFrom::Start(u64::from(index) * u64::from(len)))?;
        let mut bytes = vec![0; len as usize];
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    fn reset(&self) -> io::Result<()> {
        match fs::remove_file(&self.file) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }

    /// Constant time in the token's bytes.
    fn token_matches(&self, given: &[u8]) -> bool {
        let token = self.token.as_bytes();
        given.len() == token.len()
            && given.iter().zip(token).fold(0, |acc, (a, b)| acc | (a ^ b)) == 0
    }

    /// Answers a request for `/__bench/...`, or returns `None` for every other
    /// path. Without the right `X-Journal-Bench` header: `403`, and the file is
    /// neither read nor written.
    pub fn respond(&self, request: &mut tiny_http::Request) -> Option<Response<Cursor<Vec<u8>>>> {
        let url = request.url().to_string();
        let (path, query) = url.split_once('?').unwrap_or((&url, ""));
        if !path.starts_with("/__bench/") {
            return None;
        }
        let status = |code| Some(Response::from_data(Vec::new()).with_status_code(code));
        let authorized = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("X-Journal-Bench"))
            .is_some_and(|h| self.token_matches(h.value.as_bytes()));
        if !authorized {
            return status(403);
        }
        if path != "/__bench/blob" {
            return status(404);
        }
        match request.method() {
            Method::Put => {
                let mut body = Vec::new();
                let written = request
                    .as_reader()
                    .read_to_end(&mut body)
                    .and_then(|_| self.put(&body));
                status(if written.is_ok() { 204 } else { 500 })
            }
            Method::Get => {
                let param = |name: &str| {
                    query
                        .split('&')
                        .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
                        .and_then(|v| v.parse::<u32>().ok())
                };
                let (Some(index), Some(len)) = (param("index"), param("len")) else {
                    return status(400);
                };
                match self.get(index, len) {
                    Ok(bytes) => Some(
                        Response::from_data(bytes)
                            .with_header(super::header("Content-Type", "application/octet-stream")),
                    ),
                    Err(_) => status(404),
                }
            }
            _ => status(405),
        }
    }
}

/// Appends the raw request body to `bench.bin`.
#[tauri::command]
pub fn bench_blob_put(request: Request, bench: tauri::State<Bench>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("bench_blob_put takes raw bytes (an ArrayBuffer or Uint8Array)".into());
    };
    bench.put(bytes).map_err(|e| e.to_string())
}

/// Block `index` of `len` bytes from `bench.bin`, as raw bytes.
#[tauri::command]
pub fn bench_blob_get(
    index: u32,
    len: u32,
    bench: tauri::State<Bench>,
) -> Result<tauri::ipc::Response, String> {
    bench
        .get(index, len)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// Deletes `bench.bin`.
#[tauri::command]
pub fn bench_reset(bench: tauri::State<Bench>) -> Result<(), String> {
    bench.reset().map_err(|e| e.to_string())
}

/// The token for `X-Journal-Bench`.
#[tauri::command]
pub fn bench_token(bench: tauri::State<Bench>) -> String {
    bench.token.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, TcpListener};
    use tauri::ipc::{CallbackFn, InvokeResponseBody};
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("journal-bench-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn block(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 % 251) as u8).collect()
    }

    /// The commands through the mock runtime, with the app's real capabilities
    /// and the shell's remote origin.
    #[test]
    fn commands_put_then_get_the_same_bytes() {
        let dir = temp_dir("commands");
        let app = mock_builder()
            .manage(Bench::new(dir.clone()).unwrap())
            .invoke_handler(tauri::generate_handler![
                bench_blob_put,
                bench_blob_get,
                bench_reset,
                bench_token
            ])
            .build(tauri::generate_context!())
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let invoke = |cmd: &str, body: InvokeBody| {
            get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: cmd.into(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "http://localhost:47821/".parse().unwrap(),
                    body,
                    headers: Default::default(),
                    invoke_key: INVOKE_KEY.to_string(),
                },
            )
        };

        for len in [8192, 65536] {
            invoke("bench_reset", InvokeBody::default()).unwrap();
            let blocks = [block(len), block(len).into_iter().rev().collect()];
            for b in &blocks {
                invoke("bench_blob_put", InvokeBody::Raw(b.clone())).unwrap();
            }
            for (index, b) in blocks.iter().enumerate() {
                let args = serde_json::json!({ "index": index, "len": len });
                match invoke("bench_blob_get", InvokeBody::Json(args)).unwrap() {
                    InvokeResponseBody::Raw(got) => {
                        assert!(got == *b, "{len}-byte block {index} differs")
                    }
                    InvokeResponseBody::Json(_) => panic!("bench_blob_get must return raw bytes"),
                }
            }
        }
        assert!(invoke(
            "bench_blob_put",
            InvokeBody::Json(serde_json::json!([1, 2]))
        )
        .is_err());

        assert!(dir.join("bench.bin").exists());
        invoke("bench_reset", InvokeBody::default()).unwrap();
        assert!(!dir.join("bench.bin").exists());
        let token = match invoke("bench_token", InvokeBody::default()).unwrap() {
            InvokeResponseBody::Json(json) => serde_json::from_str::<String>(&json).unwrap(),
            InvokeResponseBody::Raw(_) => panic!("bench_token returns a string"),
        };
        assert_eq!(token.len(), 64);
        assert!(token.bytes().all(|c| c.is_ascii_hexdigit()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn tokens_differ_per_launch() {
        let dir = temp_dir("tokens");
        assert_ne!(
            Bench::new(dir.clone()).unwrap().token,
            Bench::new(dir.clone()).unwrap().token
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn http_endpoint_needs_the_token() {
        let dir = temp_dir("http");
        let bench = Bench::new(dir.clone()).unwrap();
        let token = bench.token.clone();
        // A random free port, never 47821.
        let port = loop {
            let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .unwrap()
                .local_addr()
                .unwrap()
                .port();
            if port != 47821 {
                break port;
            }
        };
        let server = tiny_http::Server::http((Ipv4Addr::LOCALHOST, port)).unwrap();
        std::thread::spawn(move || {
            for mut request in server.incoming_requests() {
                let response = bench.respond(&mut request).unwrap();
                let _ = request.respond(response);
            }
        });

        // A raw HTTP/1.1 request; returns the status and the body.
        let call = |method: &str, path: &str, token: Option<&str>, body: &[u8]| {
            let mut stream = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            let header = token
                .map(|t| format!("X-Journal-Bench: {t}\r\n"))
                .unwrap_or_default();
            write!(
                stream,
                "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{header}Content-Length: {}\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).unwrap();
            let split = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
            let status: u16 = String::from_utf8_lossy(&response[9..12]).parse().unwrap();
            (status, response[split + 4..].to_vec())
        };
        let wrong = "0".repeat(64);
        let b = block(8192);

        assert_eq!(call("PUT", "/__bench/blob", None, &b).0, 403);
        assert_eq!(call("PUT", "/__bench/blob", Some(&wrong), &b).0, 403);
        assert!(
            !dir.join("bench.bin").exists(),
            "a rejected PUT wrote the file"
        );

        assert_eq!(call("PUT", "/__bench/blob", Some(&token), &b).0, 204);
        let get = "/__bench/blob?index=0&len=8192";
        assert_eq!(call("GET", get, None, &[]).0, 403);
        assert_eq!(call("GET", get, Some(&wrong), &[]), (403, Vec::new()));
        assert_eq!(call("GET", get, Some(&token), &[]), (200, b));
        let _ = fs::remove_dir_all(dir);
    }
}
