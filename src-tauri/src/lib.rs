use std::fmt;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
#[cfg(desktop)]
use std::sync::atomic::AtomicBool;
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

mod app_lock;
mod db_key;
mod ios_keyboard;
#[cfg(any(target_os = "ios", target_os = "macos", target_os = "linux", test))]
mod webview_recovery;

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
    // Only webview_recovery.rs checks the addresses.
    #[cfg_attr(any(windows, target_os = "android"), allow(dead_code))]
    addrs: Vec<SocketAddr>,
    rebinding: AtomicUsize,
}

#[cfg_attr(any(windows, target_os = "android"), allow(dead_code))]
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

#[cfg_attr(any(windows, target_os = "android"), allow(dead_code))]
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
/// target so the capability resolves everywhere.
///
/// Desktop: `dark` is the theme the page shows, and the window and web view
/// background follow it, so a reload shows the app's colour instead of white
/// (#1368). macOS paints only the window: Tauri doesn't set a WKWebView's
/// background, so webview_recovery.rs covers a reload there.
#[tauri::command]
fn set_style<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    style: String,
    dark: bool,
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
    #[cfg(desktop)]
    {
        DARK_THEME.store(dark, Ordering::SeqCst);
        let [r, g, b] = background_rgb();
        window.set_background_color(Some(tauri::window::Color(r, g, b, 255)))?;
    }
    #[cfg(not(target_os = "ios"))]
    let _ = style;
    #[cfg(mobile)]
    let _ = dark;
    #[cfg(target_os = "android")]
    let _ = window;
    Ok(())
}

/// The app's `--background` (src/index.css), light and dark.
#[cfg(desktop)]
const BACKGROUNDS: [[u8; 3]; 2] = [[0xFD, 0xFC, 0xF8], [0x1C, 0x1B, 0x1A]];

/// Whether the page shows the dark theme (`set_style`).
#[cfg(desktop)]
static DARK_THEME: AtomicBool = AtomicBool::new(false);

/// The page's background colour now, which a reload shows.
#[cfg(desktop)]
fn background_rgb() -> [u8; 3] {
    BACKGROUNDS[DARK_THEME.load(Ordering::SeqCst) as usize]
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
/// tauri.conf.json at launch, every `UPDATE_EVERY`, and when the machine wakes
/// or the main window gets the focus once `UPDATE_MIN_GAP` has passed since the
/// last check (#1349). It downloads in the background and installs when the
/// user picks "Restart now", or at the next quit after "Later". The plugin
/// refuses an update whose signature doesn't match the public key there. A
/// failed check or download is a log line; the next check retries.
///
/// "Check for Updates…" (#1353, `check_for_updates`) asks the same loop for a check now, which
/// tells the user its result in a dialog, errors too.
#[cfg(desktop)]
fn update_loop(app: tauri::AppHandle) {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::SystemTime;

    let (nudge, nudges) = std::sync::mpsc::channel();
    app.manage(Updater {
        nudge,
        pending: Pending::default(),
    });
    // Wall-clock time, which goes on while the machine sleeps (`Instant` doesn't on macOS
    // and Linux). A clock set back counts as a long time, so it only checks once more.
    let since = |t: SystemTime| SystemTime::now().duration_since(t).unwrap_or(Duration::MAX);
    std::thread::spawn(move || {
        let mut last_check: Option<SystemTime> = None;
        let mut nudge: Option<Nudge> = None;
        loop {
            let manual = nudge == Some(Nudge::Manual);
            if manual || update_due(last_check.map_or(Duration::MAX, since), nudge.is_some()) {
                last_check = Some(SystemTime::now());
                let checked =
                    tauri::async_runtime::block_on(update(&app, manual)).map_err(|e| e.to_string());
                if let Err(e) = &checked {
                    eprintln!("update check failed: {e}");
                }
                if manual {
                    let info = app.package_info();
                    let current = info.version.to_string();
                    if let Some(text) = manual_check_message(&info.name, &current, &checked) {
                        tell(&app, checked.is_err(), text);
                    }
                }
                // The checks asked for while this one ran: it answered them.
                drain(&nudges);
            }
            let waited_from = SystemTime::now();
            nudge = match nudges.recv_timeout(UPDATE_TICK) {
                Ok(n) => Some(n),
                Err(RecvTimeoutError::Timeout) => woke(since(waited_from)).then_some(Nudge::Wake),
                Err(RecvTimeoutError::Disconnected) => return,
            };
        }
    });
}

/// "Check for Updates…" in the tray menu and the macOS app menu (#1353): one update check now,
/// its result in a dialog. Ignored while a check runs, and in dev, where the loop doesn't run.
#[cfg(desktop)]
pub fn check_for_updates<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(updater) = app.try_state::<Updater>() {
        let _ = updater.nudge.send(Nudge::Manual);
    }
}

/// Why the update loop wakes before its tick: a wake or the window's focus, or the user.
#[cfg(desktop)]
#[derive(Debug, PartialEq)]
enum Nudge {
    Wake,
    Manual,
}

/// Drops what is queued on `rx`, so a check is never started a second time for it.
#[cfg(desktop)]
fn drain<T>(rx: &std::sync::mpsc::Receiver<T>) {
    while rx.try_recv().is_ok() {}
}

/// The end of an update check that didn't fail.
#[cfg(desktop)]
#[derive(Debug)]
enum Checked {
    UpToDate,
    /// The "Restart now" / "Later" prompt was shown, or (automatic checks) was put off before.
    Prompted,
    /// The release is newer than the license key's updates cover (#1316).
    NotCovered(String),
    /// Linux outside an AppImage: the package manager updates the app.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    PackageManager,
}

/// What the dialog after "Check for Updates…" says, if anything: after a prompt, nothing.
#[cfg(desktop)]
fn manual_check_message(
    name: &str,
    current: &str,
    checked: &Result<Checked, String>,
) -> Option<String> {
    Some(match checked {
        Ok(Checked::UpToDate) => format!("{name} is up to date (v{current})."),
        Ok(Checked::Prompted) => return None,
        Ok(Checked::NotCovered(version)) => format!(
            "{name} {version} is out, but your updates have ended. Renew your license to get it."
        ),
        Ok(Checked::PackageManager) => {
            format!("{name} updates come from your package manager on this system.")
        }
        Err(_) => format!("{name} can't check for updates. Check your connection and try again."),
    })
}

/// Shows `text` with an OK button and waits for it, so the clicks on "Check for Updates…"
/// meanwhile are drained with the rest.
#[cfg(desktop)]
fn tell(app: &tauri::AppHandle, error: bool, text: String) {
    let name = app.package_info().name.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let shown = app.run_on_main_thread(move || {
        rfd::MessageDialog::new()
            .set_level(if error {
                rfd::MessageLevel::Warning
            } else {
                rfd::MessageLevel::Info
            })
            .set_title(&name)
            .set_description(text)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        let _ = tx.send(());
    });
    if shown.is_ok() {
        let _ = rx.recv();
    }
}

#[cfg(desktop)]
const UPDATE_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
#[cfg(desktop)]
const UPDATE_MIN_GAP: Duration = Duration::from_secs(60 * 60);
#[cfg(desktop)]
const UPDATE_TICK: Duration = Duration::from_secs(60);

/// Whether the update loop checks now, `since` the last check: every `UPDATE_EVERY`, and on a
/// wake or a focus (`nudged`) at most once per `UPDATE_MIN_GAP`.
#[cfg(desktop)]
fn update_due(since: Duration, nudged: bool) -> bool {
    since >= UPDATE_EVERY || (nudged && since >= UPDATE_MIN_GAP)
}

/// Whether a wait of one `UPDATE_TICK` took so long that the machine slept in it.
#[cfg(desktop)]
fn woke(waited: Duration) -> bool {
    waited > 5 * UPDATE_TICK
}

/// The update loop's state: `nudge` asks it for a check (the window got the focus, or
/// "Check for Updates…"), and `pending` holds the update the user put off with "Later".
#[cfg(desktop)]
struct Updater {
    nudge: std::sync::mpsc::Sender<Nudge>,
    pending: Pending<(tauri_plugin_updater::Update, Vec<u8>)>,
}

/// A downloaded update and its version, kept until "Restart now" or the quit (#1349).
#[cfg(desktop)]
struct Pending<U>(std::sync::Mutex<Option<(String, U)>>);

#[cfg(desktop)]
impl<U> Default for Pending<U> {
    fn default() -> Self {
        Self(std::sync::Mutex::new(None))
    }
}

#[cfg(desktop)]
impl<U> Pending<U> {
    /// Whether `version` is still to download and ask about: not when it is already pending.
    fn wants(&self, version: &str) -> bool {
        self.0.lock().unwrap().as_ref().map(|(v, _)| v.as_str()) != Some(version)
    }

    /// Keeps `update` in place of the one pending before.
    fn set(&self, version: String, update: U) {
        *self.0.lock().unwrap() = Some((version, update));
    }

    fn take(&self) -> Option<U> {
        self.0.lock().unwrap().take().map(|(_, update)| update)
    }
}

/// Gives the update loop the main window's focus, and installs the pending update when the
/// app quits (tray Quit, Cmd+Q, closing the last window where that quits the app).
#[cfg(desktop)]
fn updater_events<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("journal-updater")
        .on_event(|app, event| {
            // None in dev, where the loop doesn't run.
            let Some(updater) = app.try_state::<Updater>() else {
                return;
            };
            match event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Focused(true),
                    ..
                } if label == "main" => {
                    let _ = updater.nudge.send(Nudge::Wake);
                }
                tauri::RunEvent::Exit => {
                    if let Some((update, bytes)) = updater.pending.take() {
                        // The user quit: Windows' installer mustn't open the app again.
                        if let Err(e) = update.restart_after_install(false).install(bytes) {
                            eprintln!("can't install the update: {e}");
                        }
                    }
                }
                _ => {}
            }
        })
        .build()
}

/// One update check. A `manual` one ("Check for Updates…") asks about an update put off with
/// "Later" again.
#[cfg(desktop)]
async fn update(
    app: &tauri::AppHandle,
    manual: bool,
) -> Result<Checked, Box<dyn std::error::Error>> {
    use tauri_plugin_updater::UpdaterExt;

    // On Linux only the AppImage replaces itself; a .deb is updated by
    // installing the new one.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Ok(Checked::PackageManager);
    }
    let Some(update) = app.updater()?.check().await? else {
        return Ok(Checked::UpToDate);
    };
    // A license key's updates cover the releases up to its updatesUntil (#1316), as the
    // billing Worker confirms it, and every security release. A skipped one isn't
    // downloaded; the web view tells the user about it once.
    let security = is_security_release(&update.raw_json);
    let until = if security {
        None
    } else {
        premium::updates_until(app, update.date).await
    };
    let install = should_install(update.date, until, security);
    premium::set_skipped_update(app, (!install).then(|| update.version.clone()));
    if !install {
        return Ok(Checked::NotCovered(update.version));
    }
    // Already put off with "Later": it installs at the quit, so only the user asks again.
    let pending = &app.state::<Updater>().inner().pending;
    let version = update.version.clone();
    if pending.wants(&version) {
        let bytes = update.download(|_, _| {}, || {}).await?;
        // A newer release replaces the pending one, also when the user quits with this prompt open.
        pending.set(version.clone(), (update, bytes));
    } else if !manual {
        return Ok(Checked::Prompted);
    }

    // rfd's dialog has to run on the main thread once GTK's event loop owns
    // it (see run()), and macOS wants UI on the main thread anyway.
    const RESTART: &str = "Restart now";
    let name = app.package_info().name.clone();
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

    // Taken out first, so the restart's own exit doesn't install it a second time.
    if rx.recv()? {
        if let Some((update, bytes)) = pending.take() {
            // On Windows this starts the installer and exits the app.
            update.install(bytes)?;
            #[cfg(target_os = "macos")]
            relaunch_macos_bundle(app);
            #[cfg(not(target_os = "macos"))]
            app.restart();
        }
    }
    Ok(Checked::Prompted)
}

/// Relaunch the updated app the way Sparkle does (#1350). The updater swaps a
/// new bundle into the same path, and tauri's `restart()` runs `open -n` while
/// this process is still alive, so the Dock shows the relaunched app as a
/// second icon next to the pinned one. Instead: re-register the new bundle with
/// LaunchServices, leave a detached helper that waits for this process to exit
/// and then opens the bundle, and exit. Outside a .app (a dev build) this is
/// the plain restart.
#[cfg(target_os = "macos")]
fn relaunch_macos_bundle(app: &tauri::AppHandle) {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

    let Some(bundle) = tauri::process::current_binary(&app.env())
        .ok()
        .as_deref()
        .and_then(app_bundle)
        .map(std::path::Path::to_path_buf)
    else {
        app.restart();
    };
    if let Err(e) = Command::new(LSREGISTER).arg("-f").arg(&bundle).status() {
        eprintln!("lsregister failed: {e}");
    }
    // `$0` is our pid and `$1` the bundle, so the path needs no quoting.
    let helper = Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"while kill -0 "$0" 2>/dev/null; do sleep 0.1; done; exec /usr/bin/open "$1""#)
        .arg(std::process::id().to_string())
        .arg(&bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
    match helper {
        Ok(_) => app.exit(0),
        Err(e) => {
            eprintln!("relaunch helper failed: {e}");
            app.restart();
        }
    }
}

/// The `.app` bundle `exe` runs from (`X.app/Contents/MacOS/<exe>`), or `None`
/// for a binary outside one.
#[cfg(any(target_os = "macos", test))]
fn app_bundle(exe: &std::path::Path) -> Option<&std::path::Path> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app")
        .then_some(bundle)
}

/// Whether latest.json marks the release as a security release (`"security": true`, set by
/// desktop-release.yml). The field isn't signed, which is fine: it can only make the updater
/// install, and `download()` still checks the bundle's signature.
#[cfg(desktop)]
fn is_security_release(manifest: &serde_json::Value) -> bool {
    manifest.get("security") == Some(&serde_json::Value::Bool(true))
}

/// Whether to install a release published at `pub_date` (latest.json) for a license key whose
/// updates end at `updates_until` (#1316): on or before that date it is covered. A security
/// release, no key (the trial, the read-only app, the public build) and an unknown date
/// install, so a bad manifest or license never keeps anyone on an old build.
#[cfg(desktop)]
fn should_install(
    pub_date: Option<time::OffsetDateTime>,
    updates_until: Option<time::OffsetDateTime>,
    security: bool,
) -> bool {
    if security {
        return true;
    }
    match (pub_date, updates_until) {
        (Some(published), Some(until)) => published <= until,
        _ => true,
    }
}

/// The app menu's item. Not the tray's id: every menu listener sees both menus' clicks.
#[cfg(target_os = "macos")]
const CHECK_FOR_UPDATES_MENU_ID: &str = "app-menu-check-for-updates";

/// Tauri's default macOS menu with "Check for Updates…" after About (#1353).
#[cfg(target_os = "macos")]
fn app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};

    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
        let item = MenuItem::with_id(
            app,
            CHECK_FOR_UPDATES_MENU_ID,
            "Check for Updates…",
            true,
            None::<&str>,
        )?;
        app_menu.insert(&item, 1)?;
    }
    Ok(menu)
}

/// Open external links and the sign-in outside the web view (#1188): the
/// default browser on desktop, an in-app browser on iOS and Android. Opener is on
/// mobile too, for the store listing's `itms-apps://` and `market://` links (#1439).
fn link_plugins<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
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
        .plugin(system_bars_plugin())
        .plugin(db_key::plugin());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(updater_events());
    // Face ID / Touch ID and BiometricPrompt for the app lock (app_lock.rs, #1364).
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_biometric::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu).on_menu_event(|app, event| {
        if event.id() == CHECK_FOR_UPDATES_MENU_ID {
            check_for_updates(app);
        }
    });
    #[cfg(any(target_os = "ios", target_os = "macos", target_os = "linux"))]
    let builder = webview_recovery::register(builder);
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
                not(any(target_os = "ios", target_os = "macos", target_os = "linux")),
                allow(unused_variables)
            )]
            let window = builder.build()?;

            #[cfg(any(target_os = "ios", target_os = "macos"))]
            window.with_webview(allow_swipe_navigation)?;

            #[cfg(target_os = "linux")]
            webview_recovery::watch(&window)?;

            #[cfg(target_os = "ios")]
            hide_form_accessory_bar();

            // `with_webview` runs this on the main thread; `inner()` is the WKWebView.
            #[cfg(target_os = "ios")]
            window.with_webview(|webview| unsafe {
                ios_keyboard::hold_page(webview.inner().cast())
            })?;

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
        assert!(should_install(at("2027-06-01T12:00:00Z"), until, false), "before");
        assert!(should_install(at("2027-11-16T00:00:00Z"), until, false), "on it");
        assert!(!should_install(at("2027-11-16T00:00:01Z"), until, false), "after");
        assert!(should_install(at("2030-01-01T00:00:00Z"), None, false), "no key");
        assert!(should_install(None, until, false), "unknown release date");
        assert!(should_install(None, None, false));
        // A renewal moves the date: the skipped release installs at the next check.
        let release = at("2027-12-01T00:00:00Z");
        assert!(!should_install(release, until, false));
        assert!(should_install(release, at("2028-11-16T00:00:00Z"), false));
    }

    #[cfg(desktop)]
    #[test]
    fn a_security_release_installs_after_the_updates_end() {
        let at = |iso: &str| {
            Some(
                time::OffsetDateTime::parse(iso, &time::format_description::well_known::Rfc3339)
                    .unwrap(),
            )
        };
        // updates_until as the Worker confirmed it, and a release after it.
        let (release, until) = (at("2027-12-01T00:00:00Z"), at("2027-11-16T00:00:00Z"));
        assert!(should_install(release, until, true), "security release");
        assert!(!should_install(release, until, false), "any other release");

        let manifest = |extra: serde_json::Value| {
            let mut m = serde_json::json!({ "version": "2.70.0", "pub_date": "2027-12-01T00:00:00Z", "platforms": {} });
            m.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            is_security_release(&m)
        };
        assert!(manifest(serde_json::json!({ "security": true })));
        assert!(!manifest(serde_json::json!({})));
        assert!(!manifest(serde_json::json!({ "security": false })));
        assert!(!manifest(serde_json::json!({ "security": "true" })));
    }

    #[cfg(desktop)]
    #[test]
    fn updates_are_checked_every_few_hours_and_on_a_wake_at_most_hourly() {
        let minutes = |m: u64| Duration::from_secs(m * 60);
        assert!(update_due(Duration::MAX, false), "the first check, at launch");
        assert!(!update_due(minutes(239), false));
        assert!(update_due(minutes(240), false), "every 4 hours");
        // A wake or a focus checks, but not again within the hour.
        assert!(!update_due(minutes(59), true));
        assert!(update_due(minutes(60), true));
        assert!(!update_due(minutes(60), false));

        assert!(!woke(UPDATE_TICK), "an ordinary tick");
        assert!(!woke(minutes(5)), "a busy machine");
        assert!(woke(minutes(6)));
        assert!(woke(Duration::MAX), "the clock set back");
    }

    #[cfg(desktop)]
    #[test]
    fn a_pending_update_is_not_asked_about_twice_and_a_newer_one_replaces_it() {
        let pending = Pending::default();
        assert!(pending.wants("2.74.0"), "nothing pending");

        pending.set("2.74.0".into(), "2.74.0 bytes");
        assert!(!pending.wants("2.74.0"), "already pending: no download, no prompt");
        assert!(pending.wants("2.75.0"));

        pending.set("2.75.0".into(), "2.75.0 bytes");
        assert!(!pending.wants("2.75.0"));
        assert_eq!(pending.take(), Some("2.75.0 bytes"), "the quit installs the newer one");
        assert_eq!(pending.take(), None, "and only once");
        assert!(pending.wants("2.75.0"));
    }

    #[cfg(desktop)]
    #[test]
    fn check_for_updates_tells_every_result_but_the_prompt() {
        let message = |checked| manual_check_message("Journal", "2.73.2", &checked);
        assert_eq!(
            message(Ok(Checked::UpToDate)).as_deref(),
            Some("Journal is up to date (v2.73.2).")
        );
        assert_eq!(
            message(Ok(Checked::Prompted)),
            None,
            "the prompt was the answer"
        );
        assert_eq!(
            message(Ok(Checked::NotCovered("2.80.0".into()))).as_deref(),
            Some(
                "Journal 2.80.0 is out, but your updates have ended. Renew your license to get it."
            )
        );
        assert_eq!(
            message(Ok(Checked::PackageManager)).as_deref(),
            Some("Journal updates come from your package manager on this system.")
        );
        assert_eq!(
            message(Err("error sending request".into())).as_deref(),
            Some("Journal can't check for updates. Check your connection and try again.")
        );
    }

    #[cfg(desktop)]
    #[test]
    fn a_check_asked_for_while_one_runs_starts_no_second_one() {
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(Nudge::Manual).unwrap();
        tx.send(Nudge::Manual).unwrap();
        tx.send(Nudge::Wake).unwrap();
        drain(&rx);
        assert!(rx.try_recv().is_err(), "the running check answered them");
        tx.send(Nudge::Manual).unwrap();
        assert_eq!(
            rx.try_recv(),
            Ok(Nudge::Manual),
            "one after it starts a check"
        );
    }

    #[test]
    fn app_bundle_is_the_app_the_binary_runs_from() {
        use std::path::Path;
        assert_eq!(
            app_bundle(Path::new("/Applications/Journal+.app/Contents/MacOS/journal")),
            Some(Path::new("/Applications/Journal+.app"))
        );
        assert_eq!(app_bundle(Path::new("/repo/src-tauri/target/debug/journal")), None);
        assert_eq!(app_bundle(Path::new("/Applications/Journal/Contents/MacOS/journal")), None);
        assert_eq!(app_bundle(Path::new("/Journal.app/Contents/Resources/journal")), None);
        assert_eq!(app_bundle(Path::new("journal")), None);
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
