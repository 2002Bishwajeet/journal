use tauri::{WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Response, Server};

/// Fixed port for the local HTTP server that serves the built frontend.
///
/// The desktop shell deliberately does NOT use Tauri's default
/// `tauri://localhost` custom protocol. It serves `dist/` over a real
/// `http://localhost` origin instead, because:
///
///   1. Service workers refuse to register on `tauri://` in WKWebView
///      (wry#389). `http://localhost` is a secure context, so they register.
///   2. The YouAuth OAuth flow builds its callback as
///      `${window.location.origin}/auth/finalize`
///      (src/hooks/auth/useYouAuthAuthorization.ts). An identity server
///      rejects a `tauri://` callback; `http://localhost:PORT` is an ordinary
///      HTTP origin the backend already accepts.
///
/// THE PORT MUST STAY FIXED AND HARDCODED. The origin is the storage key for
/// localStorage / IndexedDB / OPFS — i.e. the user's entire local database. An
/// OS-assigned (port 0) or otherwise changing port would hand the webview a
/// different origin on every launch and silently wipe the user's notes.
/// Never make this dynamic, and never change the value once shipped.
const PORT: u16 = 47821;

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

/// Blocking HTTP server for the app's assets. Runs on its own thread.
///
/// `asset_resolver()` reads the embedded `frontendDist` in release builds, and
/// falls back to reading `../dist` off disk in dev builds.
fn serve(app: tauri::AppHandle) {
    // Loopback only. Never 0.0.0.0 — that would publish the user's journal,
    // cross-origin-isolation headers and all, to every device on the LAN.
    let server = Server::http(("127.0.0.1", PORT)).expect("failed to bind local asset server");

    for request in server.incoming_requests() {
        let path = request.url().split('?').next().unwrap_or("/");
        let path = if path.ends_with('/') {
            format!("{path}index.html")
        } else {
            path.to_string()
        };

        let resolver = app.asset_resolver();
        // SPA fallback: client-side routes (/auth/finalize, /note/<id>, ...)
        // are not files on disk and must resolve to the app shell.
        let asset = resolver
            .get(path)
            .or_else(|| resolver.get("/index.html".into()));

        let response = match asset {
            // Content-Type comes from Tauri's own extension/sniffing logic.
            Some(asset) => Response::from_data(asset.bytes)
                .with_header(header("Content-Type", &asset.mime_type)),
            None => Response::from_data(Vec::new()).with_status_code(404),
        }
        // PGlite and WebLLM need SharedArrayBuffer, which requires a
        // cross-origin-isolated context. The hosted PWA gets these from
        // public/_headers; the desktop shell has to serve them itself.
        .with_header(header("Cross-Origin-Embedder-Policy", "require-corp"))
        .with_header(header("Cross-Origin-Opener-Policy", "same-origin"))
        .with_header(header("Cache-Control", "no-cache"));

        let _ = request.respond(response);
    }
}

/// Shared entry point for every target.
///
/// On desktop `main.rs` calls this directly. On mobile there is no `main` —
/// the platform loads the crate as a library and `#[tauri::mobile_entry_point]`
/// exports this as the symbol the generated Xcode / Gradle project calls.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || serve(handle));

            // In dev, load the Vite dev server (`devUrl`) so HMR works; it
            // already serves the COEP/COOP headers over HTTPS. In release,
            // load the local asset server above.
            let url = if tauri::is_dev() {
                WebviewUrl::App("index.html".into())
            } else {
                WebviewUrl::External(format!("http://localhost:{PORT}").parse()?)
            };

            let builder = WebviewWindowBuilder::new(app, "main", url).title("Journal");

            // Desktop-only window geometry. These are NOT harmless no-ops on
            // iOS: `tao`'s UIKit backend uses `WindowAttributes::inner_size`
            // verbatim as the UIWindow frame when it is `Some`, and only falls
            // back to `UIScreen.bounds` when it is `None`
            // (tao/src/platform_impl/ios/window.rs). `wry` then creates the
            // WKWebView with `initWithFrame: ns_view.frame()`. So on an
            // iPhone 17 (402x874pt) a 1200x800 request produced a 1200x800 CSS
            // px viewport — `window.innerWidth` reported 1200, `useDeviceType()`
            // selected `desktop`, the layout was clipped at the right edge, and
            // the 74pt of screen the too-short window never covered rendered as
            // a black bar. Leaving it unset gives the webview the full screen.
            //
            // (`min_inner_size` is separately ignored on iOS, but belongs in
            // the same block because it is equally meaningless there.)
            //
            // This lives here, in `src-tauri/src/lib.rs`, rather than in the
            // Xcode project, precisely because `gen/apple/` is git-ignored and
            // regenerated by `tauri ios init`. Nothing under `gen/` is patched.
            #[cfg(desktop)]
            let builder = builder
                .inner_size(1200.0, 800.0)
                .min_inner_size(400.0, 600.0)
                .resizable(true);

            builder.build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
