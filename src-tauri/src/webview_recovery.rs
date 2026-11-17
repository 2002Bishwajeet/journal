//! Brings the page back when the OS takes it away (#1187 iOS, #1368 macOS and Linux).
//!
//! Under memory pressure iOS and macOS kill a backgrounded WKWebView's content
//! process, and iOS can reclaim the asset server's listening socket
//! (`serve_forever` in lib.rs binds it again). Either way the web view came
//! back blank, and on macOS it then booted from scratch on the URL it first
//! loaded. Here:
//!
//! - Leaving the foreground (iOS) or losing the focus (desktop) keeps the
//!   page's URL and, on iOS and macOS, a picture of it.
//! - When the content process is gone, the picture (on macOS without one, the
//!   app's background colour) covers the web view while it loads the URL again,
//!   until the page says it is back where it was (`window.__JOURNAL_RESTORED__`,
//!   src/lib/resumeRestore.ts). The page is then told why it reloaded
//!   (src/lib/reloadReason.ts).
//! - iOS also checks on coming back that the asset server is up and the page is
//!   still there: a suspended app doesn't always hear of the termination.
//!
//! On iOS and macOS the termination comes through wry's own navigation
//! delegate, which Tauri exposes as `on_web_content_process_terminate`. Tauri's
//! default for it is a `reload`, which does nothing after a kill in the
//! background: WebKit logs "launchProcessForReload: no current item to reload".
//! Loading the URL works. On Linux it is WebKitGTK's `web-process-terminated`
//! signal (`watch`). Windows isn't covered yet (#1373).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::Url;

/// One recovery at a time: the termination and the resume check both start one.
struct Guard(AtomicBool);

impl Guard {
    const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    /// True when no recovery was running; this one runs until `end`.
    fn begin(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }

    fn end(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    fn active(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// The page's URL when the app last left the foreground. After the content
/// process is gone, the web view may no longer have one.
struct KeptUrl(Mutex<Option<Url>>);

impl KeptUrl {
    const fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// Keeps `url` unless there is none: a web view without a page keeps the old one.
    fn keep(&self, url: Option<Url>) {
        if url.is_some() {
            *self.0.lock().unwrap() = url;
        }
    }

    /// The page's URL now, or else the kept one.
    fn to_load(&self, now: Option<Url>) -> Option<Url> {
        now.or_else(|| self.0.lock().unwrap().clone())
    }
}

/// `text` as a page URL to load again: only the app's own http(s) pages, never
/// the `about:blank` a new content process starts on.
fn page_url(text: &str) -> Option<Url> {
    let url = Url::parse(text).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

#[cfg(any(target_os = "ios", target_os = "macos", target_os = "linux"))]
pub use recovery::*;

#[cfg(any(target_os = "ios", target_os = "macos", target_os = "linux"))]
mod recovery {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use tauri::webview::PlatformWebview;
    use tauri::{Manager, Runtime, Url, WebviewWindow, WindowEvent};

    use super::{page_url, Guard, KeptUrl};
    use crate::AssetServer;

    /// Set by the app once it has rendered (src/lib/resumeRestore.ts). Not
    /// `__JOURNAL_NATIVE__`: the initialization script also runs in the empty
    /// page a new content process starts with.
    const PAGE_IS_THERE: &str = "window.__JOURNAL_RESTORED__ === true";

    /// Tells the page it was loaded again (src/lib/reloadReason.ts).
    const REPORT_RELOAD: &str = "window.__JOURNAL_RELOADED__?.('content-process-terminated')";

    /// How long a shown page has to come back before the cover goes anyway.
    const RESTORE_TIMEOUT: Duration = Duration::from_secs(15);

    static RECOVERING: Guard = Guard::new();
    static LAST_URL: KeptUrl = KeptUrl::new();

    pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        #[cfg(any(target_os = "ios", target_os = "macos"))]
        let builder = builder.on_web_content_process_terminate(|webview| {
            match webview.app_handle().get_webview_window("main") {
                Some(main) if webview.label() == "main" => recover(main),
                // Another window (quick capture on macOS): Tauri's default.
                _ => {
                    let _ = webview.reload();
                }
            }
        });
        builder.on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let Some(webview) = window.app_handle().get_webview_window("main") else {
                return;
            };
            match event {
                #[cfg(target_os = "ios")]
                WindowEvent::Suspended => left(&webview),
                #[cfg(target_os = "ios")]
                WindowEvent::Resumed => {
                    std::thread::spawn(move || check(webview));
                }
                #[cfg(desktop)]
                WindowEvent::Focused(false) => left(&webview),
                // The picture is of a page the user may move on from now.
                #[cfg(target_os = "macos")]
                WindowEvent::Focused(true) if !RECOVERING.active() => {
                    let _ = webview.with_webview(|_| apple::drop_snapshot());
                }
                _ => {}
            }
        })
    }

    /// Linux: recovers the page when WebKitGTK's web process is gone.
    #[cfg(target_os = "linux")]
    pub fn watch<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
        use webkit2gtk::WebViewExt;

        let window_ = window.clone();
        window.with_webview(move |platform| {
            platform
                .inner()
                .connect_web_process_terminated(move |_, reason| {
                    eprintln!("web process terminated: {reason:?}");
                    recover(window_.clone());
                });
        })
    }

    /// Keeps the URL and a picture of the page, ready for a recovery. Runs on the
    /// main thread, so the URL is read there and not waited for.
    fn left<R: Runtime>(webview: &WebviewWindow<R>) {
        if RECOVERING.active() {
            return;
        }
        let _ = webview.with_webview(|platform| LAST_URL.keep(platform_url(&platform)));
        #[cfg(any(target_os = "ios", target_os = "macos"))]
        let _ = webview.with_webview(|platform| unsafe { apple::take_snapshot(&platform) });
    }

    /// After a resume: keeps the page if it is still there, recovers it if not.
    #[cfg(target_os = "ios")]
    fn check<R: Runtime>(webview: WebviewWindow<R>) {
        if RECOVERING.active() {
            return;
        }
        let server_up = webview
            .state::<AssetServer>()
            .wait_until_up(Duration::from_secs(5));
        if server_up && answers(&webview, PAGE_IS_THERE, Duration::from_secs(3)) {
            let _ = webview.with_webview(|_| apple::drop_snapshot());
        } else {
            recover(webview);
        }
    }

    /// Covers the web view, loads the page again once the asset server is up,
    /// and uncovers it when the page is back where it was.
    fn recover<R: Runtime>(webview: WebviewWindow<R>) {
        if !RECOVERING.begin() {
            return;
        }
        std::thread::spawn(move || {
            #[cfg(any(target_os = "ios", target_os = "macos"))]
            let _ = webview.with_webview(|platform| unsafe { apple::cover(&platform) });
            if webview
                .state::<AssetServer>()
                .wait_until_up(Duration::from_secs(10))
            {
                let url = LAST_URL.to_load(current_url(&webview));
                eprintln!("web view lost its page; loading {url:?} again");
                let _ = match url {
                    Some(url) => webview.navigate(url),
                    None => webview.reload(),
                };
                if wait_until_restored(&webview) {
                    let _ = webview.eval(REPORT_RELOAD);
                }
            } else {
                eprintln!("asset server is down; can't load the web view again");
            }
            #[cfg(any(target_os = "ios", target_os = "macos"))]
            let _ = webview.with_webview(|_| apple::uncover());
            RECOVERING.end();
        });
    }

    /// Waits for the page to say it is back. On desktop the page may load
    /// behind a window that stays hidden for hours, where it doesn't render:
    /// the time starts once the window has the focus.
    fn wait_until_restored<R: Runtime>(webview: &WebviewWindow<R>) -> bool {
        let mut deadline = Instant::now() + RESTORE_TIMEOUT;
        loop {
            if answers(webview, PAGE_IS_THERE, Duration::from_secs(1)) {
                return true;
            }
            #[cfg(desktop)]
            if !webview.is_focused().unwrap_or(true) {
                deadline = Instant::now() + RESTORE_TIMEOUT;
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    /// True when `js` evaluates to `true` in the page within `timeout`. A page
    /// whose content process is gone gives no result.
    fn answers<R: Runtime>(webview: &WebviewWindow<R>, js: &str, timeout: Duration) -> bool {
        let (tx, rx) = mpsc::channel();
        if webview
            .eval_with_callback(js, move |result| {
                let _ = tx.send(result == "true");
            })
            .is_err()
        {
            return false;
        }
        rx.recv_timeout(timeout).unwrap_or(false)
    }

    /// The web view's URL now. Not `WebviewWindow::url`, which misses the app's
    /// own navigations (`history.pushState`) and stays on the URL it first
    /// loaded. Off the main thread only: it waits for the main thread.
    fn current_url<R: Runtime>(webview: &WebviewWindow<R>) -> Option<Url> {
        let (tx, rx) = mpsc::channel();
        let _ = webview.with_webview(move |platform| {
            let _ = tx.send(platform_url(&platform));
        });
        rx.recv_timeout(Duration::from_secs(1)).ok().flatten()
    }

    /// The URL of the page in `platform`. `with_webview` runs this on the main
    /// thread.
    fn platform_url(platform: &PlatformWebview) -> Option<Url> {
        #[cfg(any(target_os = "ios", target_os = "macos"))]
        let text = unsafe { apple::page_url(platform.inner().cast()) };
        #[cfg(target_os = "linux")]
        let text = webkit2gtk::WebViewExt::uri(&platform.inner()).map(|uri| uri.to_string());
        page_url(&text?)
    }

    /// WKWebView: the URL and the picture that covers a reload.
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    mod apple {
        use std::cell::RefCell;

        #[cfg(target_os = "ios")]
        use objc2::rc::Allocated;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use tauri::webview::PlatformWebview;

        thread_local! {
            /// Main thread only: an image view of the page as it was when the
            /// app last left the foreground.
            static SNAPSHOT: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
            /// Main thread only: the view on top of the web view during a recovery.
            static COVER: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
        }

        /// # Safety
        /// `web_view` is a WKWebView, and this runs on the main thread.
        pub unsafe fn page_url(web_view: *const AnyObject) -> Option<String> {
            let url: Option<Retained<AnyObject>> = objc2::msg_send![web_view, URL];
            let text: Option<Retained<AnyObject>> =
                objc2::msg_send![url.as_deref()?, absoluteString];
            let utf8: *const std::ffi::c_char = objc2::msg_send![text.as_deref()?, UTF8String];
            Some(std::ffi::CStr::from_ptr(utf8).to_str().ok()?.to_owned())
        }

        /// `inner()` is the WKWebView, and `with_webview` runs the callers on the
        /// main thread.
        unsafe fn web_view(platform: &PlatformWebview) -> &AnyObject {
            &*platform.inner().cast::<AnyObject>()
        }

        /// Keeps a picture of the page in an image view, ready to cover the web
        /// view. A copy of the pixels: `snapshotViewAfterScreenUpdates:` shows the
        /// content process's live layers, which go blank with the process.
        ///
        /// # Safety
        /// Runs on the main thread.
        pub unsafe fn take_snapshot(platform: &PlatformWebview) {
            let done = block2::RcBlock::new(|image: *mut AnyObject, _error: *mut AnyObject| {
                let Some(image) = (unsafe { image.as_ref() }) else {
                    return;
                };
                // WebKit calls this on the main thread. The view's frame is the
                // image's size, which is the web view's bounds.
                #[cfg(target_os = "ios")]
                let view: Option<Retained<AnyObject>> = unsafe {
                    let view: Allocated<AnyObject> =
                        objc2::msg_send![objc2::class!(UIImageView), alloc];
                    objc2::msg_send![view, initWithImage: image]
                };
                #[cfg(target_os = "macos")]
                let view: Option<Retained<AnyObject>> = unsafe {
                    objc2::msg_send![objc2::class!(NSImageView), imageViewWithImage: image]
                };
                SNAPSHOT.with(|snapshot| *snapshot.borrow_mut() = view);
            });
            let no_configuration: *const AnyObject = std::ptr::null();
            let _: () = objc2::msg_send![
                web_view(platform),
                takeSnapshotWithConfiguration: no_configuration,
                completionHandler: &*done
            ];
        }

        pub fn drop_snapshot() {
            SNAPSHOT.with(|snapshot| snapshot.take());
        }

        /// Puts the picture over the web view. On macOS without one, a view of
        /// the app's background colour, so the reload never shows white.
        ///
        /// # Safety
        /// Runs on the main thread.
        pub unsafe fn cover(platform: &PlatformWebview) {
            let web_view = web_view(platform);
            let view = SNAPSHOT.with(|snapshot| snapshot.take());
            #[cfg(target_os = "macos")]
            let view = Some(mac::fit(
                view.unwrap_or_else(|| mac::background()),
                web_view,
            ));
            if let Some(view) = view {
                let _: () = objc2::msg_send![web_view, addSubview: &*view];
                COVER.with(|cover| *cover.borrow_mut() = Some(view));
            }
        }

        pub fn uncover() {
            if let Some(view) = COVER.with(|cover| cover.take()) {
                let _: () = unsafe { objc2::msg_send![&*view, removeFromSuperview] };
            }
        }

        #[cfg(target_os = "macos")]
        mod mac {
            use objc2::rc::{Allocated, Retained};
            use objc2::runtime::AnyObject;
            use objc2_core_foundation::CGRect;

            /// NSViewWidthSizable | NSViewHeightSizable.
            const FILL_SUPERVIEW: usize = 2 | 16;

            /// `view`, sized to the web view and resized with it. A picture
            /// stretches with the window (NSImageScaleAxesIndependently).
            pub unsafe fn fit(
                view: Retained<AnyObject>,
                web_view: &AnyObject,
            ) -> Retained<AnyObject> {
                let bounds: CGRect = objc2::msg_send![web_view, bounds];
                let _: () = objc2::msg_send![&*view, setFrame: bounds];
                let _: () = objc2::msg_send![&*view, setAutoresizingMask: FILL_SUPERVIEW];
                let is_image: bool =
                    objc2::msg_send![&*view, isKindOfClass: objc2::class!(NSImageView)];
                if is_image {
                    let _: () = objc2::msg_send![&*view, setImageScaling: 1usize];
                }
                view
            }

            /// A borderless, untitled custom NSBox filled with the window's
            /// background, which follows the app's theme (set_style in lib.rs).
            pub unsafe fn background() -> Retained<AnyObject> {
                let view: Allocated<AnyObject> = objc2::msg_send![objc2::class!(NSBox), alloc];
                let view: Retained<AnyObject> = objc2::msg_send![view, init];
                let [r, g, b] = crate::background_rgb().map(|c| c as f64 / 255.0);
                let color: Retained<AnyObject> = objc2::msg_send![
                    objc2::class!(NSColor),
                    colorWithSRGBRed: r,
                    green: g,
                    blue: b,
                    alpha: 1.0f64
                ];
                // NSBoxCustom, NSNoTitle.
                let _: () = objc2::msg_send![&*view, setBoxType: 4usize];
                let _: () = objc2::msg_send![&*view, setTitlePosition: 0usize];
                let _: () = objc2::msg_send![&*view, setBorderWidth: 0.0f64];
                let _: () = objc2::msg_send![&*view, setFillColor: &*color];
                view
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Option<Url> {
        Some(Url::parse(text).unwrap())
    }

    #[test]
    fn one_recovery_at_a_time() {
        let guard = Guard::new();
        assert!(!guard.active());
        assert!(guard.begin());
        assert!(guard.active());
        // The termination and the resume check both start one: the second waits it out.
        assert!(!guard.begin());
        guard.end();
        assert!(!guard.active());
        assert!(guard.begin());
    }

    #[test]
    fn loads_the_page_url_now_or_else_the_kept_one() {
        let kept = KeptUrl::new();
        assert_eq!(kept.to_load(None), None);
        kept.keep(url("http://localhost:1421/folder-1/note-1"));
        // A web view without a page keeps the URL it had.
        kept.keep(None);
        assert_eq!(
            kept.to_load(None),
            url("http://localhost:1421/folder-1/note-1")
        );
        // The page's URL now wins over the kept one.
        assert_eq!(
            kept.to_load(url("http://localhost:1421/folder-1/note-2")),
            url("http://localhost:1421/folder-1/note-2")
        );
    }

    #[test]
    fn reloads_only_the_apps_own_pages() {
        assert_eq!(
            page_url("http://localhost:1421/folder-1/note-1?tab=2"),
            url("http://localhost:1421/folder-1/note-1?tab=2")
        );
        assert_eq!(
            page_url("https://dev.dotyou.cloud:5173/"),
            url("https://dev.dotyou.cloud:5173/")
        );
        assert_eq!(page_url("about:blank"), None);
        assert_eq!(page_url("journal://open"), None);
        assert_eq!(page_url(""), None);
    }
}
