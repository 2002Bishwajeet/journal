use std::fmt;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Response, Server};

// Paid features from the optional private submodule native/ (see build.rs).
#[cfg(journal_premium)]
#[path = "../../native/rust/mod.rs"]
mod premium;

#[cfg(not(journal_premium))]
mod premium {
    pub fn register_first<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder
    }

    pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder
    }

    /// No license key in the public build: every update installs.
    #[cfg(desktop)]
    pub async fn updates_until(
        _app: &tauri::AppHandle,
        _pub_date: Option<time::OffsetDateTime>,
    ) -> Option<time::OffsetDateTime> {
        None
    }

    #[cfg(desktop)]
    pub fn set_skipped_update(_app: &tauri::AppHandle, _version: Option<String>) {}
}

#[cfg(target_os = "ios")]
mod ios_recovery;

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
///      on Windows and Linux (`authCallbackUrl` in src/lib/native.ts; iOS,
///      Android and macOS sign in outside the web view and return on
///      `journal://`). `http://localhost:PORT` is an ordinary HTTP origin the
///      backend accepts.
///
/// THE PORT MUST STAY FIXED AND HARDCODED. The origin is the storage key for
/// localStorage / IndexedDB / OPFS — i.e. the user's entire local database. An
/// OS-assigned (port 0) or otherwise changing port would hand the webview a
/// different origin on every launch and silently wipe the user's notes.
/// Never make this dynamic, and never change the value once shipped.
///
/// There are two ports, one per build type (#1308), so a development build (or
/// a build in the iOS Simulator, which shares the Mac's loopback) never blocks
/// the installed app:
///
///   - `PROD_PORT`: builds made by the release and store workflows, which set
///     `JOURNAL_RELEASE_BUILD=1` when they compile (desktop-release.yml, and
///     the iOS and Android CI of #1304).
///   - `DEV_PORT`: every other build, local release-profile builds included.
///     That is why this is an env var and not `debug_assertions`.
///
/// How the two were chosen (IANA CSV checked 2026-11-16):
///
///   - Below every OS's ephemeral range (Linux and Android 32768–60999; macOS,
///     Windows and IANA 49152–65535), so an outgoing connection never borrows
///     them. The old 47821 was inside the Linux and Android range. Windows'
///     Hyper-V / WinNAT excluded ranges are taken from the dynamic range
///     (49152–65535 by default), so they stay clear of these as well, unless
///     someone moved that range down (`netsh int ipv4 show dynamicport tcp`).
///   - Unassigned in the IANA service-name registry: 23900–23999 has no entry.
///   - No common developer tool uses them (Vite 5173/4173/24678, Next 3000,
///     Storybook 6006, Jupyter 8888, Expo 19000–19006, Ollama 11434, MongoDB
///     27017, Syncthing 22000, Kubernetes NodePorts 30000–32767, ...).
///
/// The capabilities, Info.plist and the Android config list both origins.
const PROD_PORT: u16 = 23941;
const DEV_PORT: u16 = 23942;
const PORT: u16 = port_for(option_env!("JOURNAL_RELEASE_BUILD"));

/// `PROD_PORT` when the build sets `JOURNAL_RELEASE_BUILD=1`, else `DEV_PORT`.
const fn port_for(release_build: Option<&str>) -> u16 {
    match release_build {
        Some(value) if matches!(value.as_bytes(), b"1") => PROD_PORT,
        _ => DEV_PORT,
    }
}

/// A loopback address on `PORT` that something else already holds (or that
/// failed to bind for any other reason).
#[derive(Debug)]
struct BindError {
    addr: SocketAddr,
    source: Box<dyn std::error::Error + Send + Sync>,
}

impl fmt::Display for BindError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "can't bind {}: {}", self.addr, self.source)
    }
}

/// Binds `port` on BOTH loopback families, or fails.
///
/// The webview loads `http://localhost:PORT`, and `localhost` may resolve to
/// `::1` before `127.0.0.1`. Whatever answers on either address runs inside
/// Journal's origin and can read the session token and the local database, so
/// another process holding either one is a failed bind. The one exception: a
/// machine with no IPv6 loopback at all (`AddrNotAvailable`), where nothing
/// else can listen on `::1` either.
///
/// Loopback only. Never 0.0.0.0 / :: — that would publish the user's journal,
/// cross-origin-isolation headers and all, to every device on the LAN.
fn bind_loopback(port: u16) -> Result<Vec<Server>, BindError> {
    let v4 = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let v6 = SocketAddr::from((Ipv6Addr::LOCALHOST, port));

    let mut servers = vec![Server::http(v4).map_err(|source| BindError { addr: v4, source })?];
    match Server::http(v6) {
        Ok(server) => servers.push(server),
        Err(e)
            if e.downcast_ref::<io::Error>().map(io::Error::kind)
                == Some(io::ErrorKind::AddrNotAvailable) => {}
        Err(source) => return Err(BindError { addr: v6, source }),
    }
    Ok(servers)
}

/// Argument of the helper process that shows the port-in-use dialog (#1313).
const PORT_ERROR_ARG: &str = "--journal-port-error";

fn is_port_error_invocation(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().nth(1).as_deref() == Some(PORT_ERROR_ARG)
}

fn show_port_error() {
    #[cfg(desktop)]
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Journal")
        .set_description(format!(
            "Journal can't start: port {PORT} is in use. Most likely another copy \
             of Journal (or a Journal developer build) is already running. \
             Close it and try again."
        ))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// Tells the user the app can't start, then exits non-zero. Explicit, so it
/// holds in every build — not only release builds with `panic = "abort"`.
///
/// This runs from Tauri's setup, after the single-instance plugin has had its
/// say, so Tauri already owns GTK and rfd's dialog would never appear on
/// Linux. The dialog therefore runs in a fresh process of this executable
/// that exits before it initialises Tauri (see `run`).
fn abort_on_bind_failure(err: &BindError) -> ! {
    eprintln!("Journal can't start: {err}");
    #[cfg(desktop)]
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe).arg(PORT_ERROR_ARG).status();
    }
    std::process::exit(1);
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

/// The `/*` headers of `public/_headers`, the file Cloudflare Pages serves the
/// hosted PWA with and vite.config.ts reads for dev and preview. Reading it
/// here keeps the shell on the same cross-origin isolation (PGlite and WebLLM
/// need SharedArrayBuffer) and the same CSPs (#671, #945) as the web.
fn app_headers() -> Vec<(&'static str, &'static str)> {
    include_str!("../../public/_headers")
        .lines()
        .skip_while(|line| *line != "/*")
        .skip(1)
        .take_while(|line| line.starts_with(char::is_whitespace))
        .filter_map(|line| line.trim().split_once(": "))
        .collect()
}

/// Blocking HTTP server for the app's assets. Runs on its own thread, one per
/// bound loopback address.
///
/// `asset_resolver()` reads the embedded `frontendDist` in release builds, and
/// falls back to reading `../dist` off disk in dev builds.
///
/// This serves static assets only. Any Rust HTTP endpoint added later (for
/// example a file-backed filesystem) must require a per-launch secret: every
/// local process can reach this port, not only the webview.
fn serve(app: &tauri::AppHandle, server: &Server) {
    let headers = app_headers();
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

        let mut response = match asset {
            // Content-Type comes from Tauri's own extension/sniffing logic.
            Some(asset) => Response::from_data(asset.bytes)
                .with_header(header("Content-Type", &asset.mime_type)),
            None => Response::from_data(Vec::new()).with_status_code(404),
        }
        .with_header(header("Cache-Control", "no-cache"));
        for (name, value) in &headers {
            response.add_header(header(name, value));
        }

        let _ = request.respond(response);
    }
}

/// The premium plugins with commands, from native/rust/plugins.txt (see
/// build.rs). Empty without the submodule.
fn native_plugins() -> Vec<&'static str> {
    env!("JOURNAL_NATIVE_PLUGINS")
        .split(',')
        .filter(|name| !name.is_empty())
        .collect()
}

/// The asset server's loopback addresses, and how many of them are being bound
/// again right now (see `serve_forever`).
struct AssetServer {
    // Only ios_recovery.rs checks the addresses.
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    addrs: Vec<SocketAddr>,
    rebinding: AtomicUsize,
}

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
impl AssetServer {
    /// True when every address is held by this app and takes connections. A
    /// connection alone isn't proof: while an address is being bound again,
    /// another process could be the one answering on it.
    fn is_up(&self) -> bool {
        self.rebinding.load(Ordering::SeqCst) == 0 && self.addrs.iter().all(|a| accepts(a))
    }

    /// Waits up to `timeout` for `is_up`.
    fn wait_until_up(&self, timeout: Duration) -> bool {
        let start = std::time::Instant::now();
        while !self.is_up() {
            if start.elapsed() >= timeout {
                return false;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        true
    }
}

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
fn accepts(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(addr, Duration::from_millis(300)).is_ok()
}

/// Binds `addr` again, retrying until it is free. Loopback only, like
/// `bind_loopback`.
fn rebind(addr: SocketAddr) -> Server {
    loop {
        match Server::http(addr) {
            Ok(server) => return server,
            Err(e) => {
                eprintln!("can't bind {addr} again: {e}");
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    }
}

/// Serves `server` for as long as the app runs (#1187). tiny_http's accept
/// thread quits for good on the first `accept()` error, and `serve` then
/// returns. iOS gives that error when it reclaims the listening socket of an
/// app it suspended, so after a night in the background the web view had
/// nothing to load from. The address is bound again whenever that happens.
fn serve_forever(app: tauri::AppHandle, mut server: Server) {
    let addr = server.server_addr().to_ip().expect("bound to an IP address");
    loop {
        serve(&app, &server);
        let state = app.state::<AssetServer>();
        state.rebinding.fetch_add(1, Ordering::SeqCst);
        drop(server);
        eprintln!("asset server on {addr} stopped; binding it again");
        // Not a busy loop if accept() keeps failing right away.
        std::thread::sleep(Duration::from_millis(200));
        server = rebind(addr);
        state.rebinding.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Sets `window.__JOURNAL_NATIVE__` before any page script runs.
/// `std::env::consts::OS` is already `macos`, `windows`, `linux`, `ios` or
/// `android`, the values `NativePlatform` in src/lib/native.ts expects;
/// `plugins` is what `hasNativePlugin()` there checks.
fn native_flag_script() -> String {
    format!(
        "window.__JOURNAL_NATIVE__ = {{ platform: {:?}, plugins: {:?} }};",
        std::env::consts::OS,
        native_plugins()
    )
}

/// iOS: removes the form assistant bar (the ^ v Done row) WKWebView puts above
/// the keyboard, so the editor's own toolbar sits on the keyboard like in a
/// native app. Same trick as Capacitor's Keyboard plugin (`HideFormAccessoryBar`):
/// `WKContentView`, the view that takes the keyboard focus, answers nil for
/// `inputAccessoryView`. `class_replaceMethod` changes that one class, never
/// `UIResponder`. With the Done button gone, tapping outside the field closes
/// the keyboard.
#[cfg(target_os = "ios")]
fn hide_form_accessory_bar() {
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};

    extern "C-unwind" fn no_accessory_view(_: *mut AnyObject, _: Sel) -> *mut AnyObject {
        std::ptr::null_mut()
    }

    let Some(class) = AnyClass::get(c"WKContentView") else {
        return;
    };
    unsafe {
        objc2::ffi::class_replaceMethod(
            class as *const AnyClass as *mut AnyClass,
            objc2::sel!(inputAccessoryView),
            std::mem::transmute::<extern "C-unwind" fn(*mut AnyObject, Sel) -> *mut AnyObject, Imp>(
                no_accessory_view,
            ),
            c"@@:".as_ptr(),
        );
    }
}

/// iOS: `set_style` makes the status bar follow the in-app theme (#1080). The bar's
/// light or dark text comes from the window's user interface style, which is the
/// OS's unless the window overrides it. The page sends its theme preference:
/// "light" or "dark" overrides it, "system" (anything else) gives it back to the OS,
/// so the OS appearance still changes the "system" theme. Not on Android, where
/// MainActivity.kt reads the page's theme-color. The plugin is registered on every
/// target so the capability resolves everywhere; only iOS acts on it.
#[tauri::command]
fn set_style<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    style: String,
) -> tauri::Result<()> {
    #[cfg(target_os = "ios")]
    window.with_webview(move |webview| {
        use objc2::runtime::AnyObject;

        // UIUserInterfaceStyle: 0 unspecified (follow the OS), 1 light, 2 dark.
        let value: isize = match style.as_str() {
            "light" => 1,
            "dark" => 2,
            _ => 0,
        };
        // `inner()` is the WKWebView, and `with_webview` runs this on the main thread.
        unsafe {
            let view = &*webview.inner().cast::<AnyObject>();
            let ui_window: Option<&AnyObject> = objc2::msg_send![view, window];
            if let Some(ui_window) = ui_window {
                let _: () = objc2::msg_send![ui_window, setOverrideUserInterfaceStyle: value];
            }
        }
    })?;
    #[cfg(not(target_os = "ios"))]
    let _ = (window, style);
    Ok(())
}

fn system_bars_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("system-bars")
        .invoke_handler(tauri::generate_handler![set_style])
        .build()
}

/// iOS and macOS: turns on the back and forward swipes of the WKWebView, which
/// are off unless the app enables them (wry has the setting, Tauri doesn't pass
/// it through). On an iPhone that is the interactive swipe from the left edge
/// Safari has, on a Mac the two-finger trackpad swipe. Both walk the page's
/// history, and the app pushes an entry for every screen, sheet and dialog it
/// opens on a phone (#822), so the swipe goes back one screen at a time and does
/// nothing on the first one.
#[cfg(any(target_os = "ios", target_os = "macos"))]
fn allow_swipe_navigation(webview: tauri::webview::PlatformWebview) {
    use objc2::runtime::AnyObject;

    // `inner()` is the WKWebView, and `with_webview` runs this on the main thread.
    unsafe {
        let webview = &*webview.inner().cast::<AnyObject>();
        let _: () = objc2::msg_send![webview, setAllowsBackForwardNavigationGestures: true];
    }
}

/// Desktop auto-update (#1141). Checks the `plugins.updater` endpoint in
/// tauri.conf.json at launch and then daily, downloads in the background, and
/// installs only when the user picks "Restart now". The plugin refuses an
/// update whose signature doesn't match the public key there. A failed check
/// or download is a log line; the next check retries.
#[cfg(desktop)]
fn update_loop(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        if let Err(e) = tauri::async_runtime::block_on(update(&app)) {
            eprintln!("update check failed: {e}");
        }
        std::thread::sleep(std::time::Duration::from_secs(24 * 60 * 60));
    });
}

#[cfg(desktop)]
async fn update(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_updater::UpdaterExt;

    // On Linux only the AppImage replaces itself; a .deb is updated by
    // installing the new one.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Ok(());
    }
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    // A license key's updates cover the releases up to its updatesUntil (#1316), as the
    // billing Worker confirms it. A skipped one isn't downloaded; the web view tells the user
    // about it once.
    let install = should_install(update.date, premium::updates_until(app, update.date).await);
    premium::set_skipped_update(app, (!install).then(|| update.version.clone()));
    if !install {
        return Ok(());
    }
    let bytes = update.download(|_, _| {}, || {}).await?;

    // rfd's dialog has to run on the main thread once GTK's event loop owns
    // it (see run()), and macOS wants UI on the main thread anyway.
    const RESTART: &str = "Restart now";
    let name = app.package_info().name.clone();
    let version = update.version.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = rfd::MessageDialog::new()
            .set_title(&name)
            .set_description(format!(
                "{name} {version} is ready. Restart to finish the update."
            ))
            .set_buttons(rfd::MessageButtons::OkCancelCustom(
                RESTART.into(),
                "Later".into(),
            ))
            .show();
        let _ = tx.send(
            result == rfd::MessageDialogResult::Ok
                || result == rfd::MessageDialogResult::Custom(RESTART.into()),
        );
    })?;

    if rx.recv()? {
        // On Windows this starts the installer and exits the app.
        update.install(bytes)?;
        app.restart();
    }
    Ok(())
}

/// Whether to install a release published at `pub_date` (latest.json) for a license key whose
/// updates end at `updates_until` (#1316): on or before that date it is covered. No key (the
/// trial, the read-only app, the public build) and an unknown date install, so a bad manifest
/// or license never keeps anyone on an old build.
#[cfg(desktop)]
fn should_install(
    pub_date: Option<time::OffsetDateTime>,
    updates_until: Option<time::OffsetDateTime>,
) -> bool {
    match (pub_date, updates_until) {
        (Some(published), Some(until)) => published <= until,
        _ => true,
    }
}

/// Open external links and the sign-in outside the web view (#1188): the
/// default browser on desktop, an in-app browser on iOS and Android.
fn link_plugins<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_opener::init());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_browser::init());
    builder
}

/// Shared entry point for every target.
///
/// On desktop `main.rs` calls this directly. On mobile there is no `main` —
/// the platform loads the crate as a library and `#[tauri::mobile_entry_point]`
/// exports this as the symbol the generated Xcode / Gradle project calls.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Helper invocation from `abort_on_bind_failure`: show the dialog before
    // Tauri initialises GTK, which would otherwise swallow it on Linux.
    if is_port_error_invocation(std::env::args()) {
        show_port_error();
        return;
    }

    let builder = premium::register_first(tauri::Builder::default())
        // journal.cloudx.run links (iOS Universal Links, Android App Links) and
        // journal:// links (desktop) open the app; useDeepLinks routes them.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(system_bars_plugin());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "ios")]
    let builder = ios_recovery::register(builder);
    let builder = link_plugins(builder);

    premium::register(builder)
        .setup(|app| {
            // Bound here, not before Tauri starts, so a second launch of this
            // build reaches the single-instance plugin (registered first, and
            // it focuses the running window and exits) instead of failing on
            // the port the first launch holds (#1313). Still before any window
            // exists, so none loads a page from another process on the port.
            let servers = bind_loopback(PORT).unwrap_or_else(|e| abort_on_bind_failure(&e));

            // Installers register journal:// on Windows and Linux; this covers
            // dev builds and AppImages. macOS registers it from Info.plist.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("can't register journal:// links: {e}");
                }
            }

            app.manage(AssetServer {
                addrs: servers
                    .iter()
                    .map(|s| s.server_addr().to_ip().expect("bound to an IP address"))
                    .collect(),
                rebinding: AtomicUsize::new(0),
            });
            for server in servers {
                let handle = app.handle().clone();
                std::thread::spawn(move || serve_forever(handle, server));
            }

            // In dev, load the Vite dev server (`devUrl`) so HMR works; it
            // already serves the COEP/COOP headers over HTTPS. In release,
            // load the local asset server above.
            let url = if tauri::is_dev() {
                WebviewUrl::App("index.html".into())
            } else {
                WebviewUrl::External(format!("http://localhost:{PORT}").parse()?)
            };

            let builder = WebviewWindowBuilder::new(app, "main", url)
                .title(&app.package_info().name)
                // Read by isNativeApp() in src/lib/native.ts. Main frame only:
                // live-block iframes don't need to know.
                .initialization_script(native_flag_script());

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

            #[cfg_attr(
                not(any(target_os = "ios", target_os = "macos")),
                allow(unused_variables)
            )]
            let window = builder.build()?;

            #[cfg(any(target_os = "ios", target_os = "macos"))]
            window.with_webview(allow_swipe_navigation)?;

            #[cfg(target_os = "ios")]
            hide_form_accessory_bar();

            #[cfg(desktop)]
            if !tauri::is_dev() {
                update_loop(app.handle().clone());
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// A port free on both families right now. Never `PORT`.
    fn free_port() -> u16 {
        loop {
            let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .unwrap()
                .local_addr()
                .unwrap()
                .port();
            let v6_free =
                !has_ipv6_loopback() || TcpListener::bind((Ipv6Addr::LOCALHOST, port)).is_ok();
            if port != PORT && v6_free {
                return port;
            }
        }
    }

    fn has_ipv6_loopback() -> bool {
        TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).is_ok()
    }

    #[test]
    fn release_builds_get_their_own_port_below_every_ephemeral_range() {
        assert_ne!(PROD_PORT, DEV_PORT);
        for port in [PROD_PORT, DEV_PORT] {
            assert!((10000..=32767).contains(&port), "{port}");
        }
        assert_eq!(port_for(Some("1")), PROD_PORT);
        assert_eq!(port_for(None), DEV_PORT);
        assert_eq!(port_for(Some("")), DEV_PORT);
        assert_eq!(port_for(Some("0")), DEV_PORT);
        assert_eq!(PORT, port_for(option_env!("JOURNAL_RELEASE_BUILD")));
    }

    #[test]
    fn app_headers_match_the_web() {
        let headers = app_headers();
        let get = |name| headers.iter().find(|(n, _)| *n == name).map(|(_, v)| *v);
        assert_eq!(get("Cross-Origin-Embedder-Policy"), Some("require-corp"));
        assert_eq!(get("Cross-Origin-Opener-Policy"), Some("same-origin"));
        assert_eq!(get("Content-Security-Policy"), Some("frame-src 'self'"));
        assert!(get("Content-Security-Policy-Report-Only").is_some());
        // The /assets/* block stays out: no immutable caching of a local dist/.
        assert!(get("Cache-Control").is_none());
    }

    #[test]
    fn native_flag_names_this_platform() {
        let os = std::env::consts::OS;
        assert!(["macos", "windows", "linux", "ios", "android"].contains(&os));
        assert_eq!(
            native_flag_script(),
            format!(
                "window.__JOURNAL_NATIVE__ = {{ platform: \"{os}\", plugins: {:?} }};",
                native_plugins()
            )
        );
    }

    #[cfg(not(journal_premium))]
    #[test]
    fn no_native_plugins_without_premium() {
        assert!(native_plugins().is_empty());
        assert!(native_flag_script().ends_with("plugins: [] };"));
    }

    #[cfg(desktop)]
    #[test]
    fn a_key_gets_the_releases_up_to_its_updates_until() {
        let at = |iso: &str| {
            Some(
                time::OffsetDateTime::parse(iso, &time::format_description::well_known::Rfc3339)
                    .unwrap(),
            )
        };
        let until = at("2027-11-16T00:00:00Z");
        assert!(should_install(at("2027-06-01T12:00:00Z"), until), "before");
        assert!(should_install(at("2027-11-16T00:00:00Z"), until), "on it");
        assert!(!should_install(at("2027-11-16T00:00:01Z"), until), "after");
        assert!(should_install(at("2030-01-01T00:00:00Z"), None), "no key");
        assert!(should_install(None, until), "unknown release date");
        assert!(should_install(None, None));
        // A renewal moves the date: the skipped release installs at the next check.
        let release = at("2027-12-01T00:00:00Z");
        assert!(!should_install(release, until));
        assert!(should_install(release, at("2028-11-16T00:00:00Z")));
    }

    #[test]
    fn port_error_helper_is_recognised_by_its_first_argument() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_port_error_invocation(args(&["journal", PORT_ERROR_ARG])));
        assert!(!is_port_error_invocation(args(&["journal"])));
        assert!(!is_port_error_invocation(args(&["journal", "journal://note/1"])));
    }

    #[test]
    fn free_port_binds_both_families() {
        let port = free_port();
        let servers = bind_loopback(port).expect("free port should bind");
        let addrs: Vec<_> = servers
            .iter()
            .map(|s| s.server_addr().to_ip().unwrap())
            .collect();
        assert!(addrs.contains(&SocketAddr::from((Ipv4Addr::LOCALHOST, port))));
        if has_ipv6_loopback() {
            assert!(addrs.contains(&SocketAddr::from((Ipv6Addr::LOCALHOST, port))));
        } else {
            eprintln!("no IPv6 loopback: only checked 127.0.0.1");
        }
    }

    #[test]
    fn port_held_on_ipv4_fails() {
        let port = free_port();
        let _squatter = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
        let err = bind_loopback(port).err().expect("held port must not bind");
        assert_eq!(err.addr, SocketAddr::from((Ipv4Addr::LOCALHOST, port)));
    }

    fn asset_server(addrs: Vec<SocketAddr>) -> AssetServer {
        AssetServer {
            addrs,
            rebinding: AtomicUsize::new(0),
        }
    }

    #[test]
    fn asset_server_is_up_only_while_ours_accepts() {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, free_port()));
        let state = asset_server(vec![addr]);
        assert!(!state.is_up(), "nothing listening");

        let _server = Server::http(addr).unwrap();
        assert!(state.is_up());

        // Something answers, but our own server is being bound again.
        state.rebinding.fetch_add(1, Ordering::SeqCst);
        assert!(!state.is_up());
        assert!(!state.wait_until_up(Duration::from_millis(250)));
    }

    #[test]
    fn rebind_waits_for_the_address() {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, free_port()));
        let squatter = TcpListener::bind(addr).unwrap();
        let rebound = std::thread::spawn(move || rebind(addr));
        std::thread::sleep(Duration::from_millis(300));
        assert!(!rebound.is_finished(), "must not bind while the port is held");

        drop(squatter);
        let server = rebound.join().unwrap();
        assert_eq!(server.server_addr().to_ip(), Some(addr));
        assert!(asset_server(vec![addr]).is_up());
    }

    #[test]
    fn port_held_on_ipv6_fails() {
        if !has_ipv6_loopback() {
            eprintln!("skipped: no IPv6 loopback on this machine");
            return;
        }
        let port = free_port();
        let _squatter = TcpListener::bind((Ipv6Addr::LOCALHOST, port)).unwrap();
        let err = bind_loopback(port).err().expect("held port must not bind");
        assert_eq!(err.addr, SocketAddr::from((Ipv6Addr::LOCALHOST, port)));
    }
}
