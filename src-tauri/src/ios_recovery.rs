//! iOS: brings the page back when iOS takes it away in the background (#1187).
//!
//! Under memory pressure iOS kills a backgrounded WKWebView's content process,
//! and it can reclaim the asset server's listening socket (`serve_forever` in
//! lib.rs binds it again). Either way the web view came back blank. Here:
//!
//! - Leaving the foreground keeps the page's URL and a picture of it.
//! - Coming back checks the asset server and asks the page whether it is still
//!   there. If it isn't, or WebKit reports the content process gone, the
//!   picture covers the web view while it loads the URL again, until the page
//!   says it is back where it was (`window.__JOURNAL_RESTORED__`,
//!   src/lib/resumeRestore.ts).
//!
//! The termination comes through wry's own navigation delegate, which Tauri
//! exposes as `on_web_content_process_terminate`. Tauri's default for it is a
//! `reload`, which does nothing after a kill in the background: WebKit logs
//! "launchProcessForReload: no current item to reload". Loading the URL works.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use objc2::rc::{Allocated, Retained};
use objc2::runtime::AnyObject;
use tauri::{Manager, Runtime, Url, WebviewWindow, WindowEvent};

use crate::AssetServer;

/// Set by the app once it has rendered (src/lib/resumeRestore.ts). Not
/// `__JOURNAL_NATIVE__`: the initialization script also runs in the empty page
/// a new content process starts with.
const PAGE_IS_THERE: &str = "window.__JOURNAL_RESTORED__ === true";

/// One recovery at a time: the termination and the resume check both start one.
static RECOVERING: AtomicBool = AtomicBool::new(false);

/// The page's URL when the app left the foreground. After the content process
/// is gone, the web view may no longer have one.
static LAST_URL: Mutex<Option<Url>> = Mutex::new(None);

thread_local! {
    /// Main thread only: a UIImageView of the page as it was when the app left
    /// the foreground.
    static SNAPSHOT: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .on_web_content_process_terminate(|webview| {
            if let Some(window) = webview.app_handle().get_webview_window(webview.label()) {
                recover(window);
            }
        })
        .on_window_event(|window, event| {
            let Some(webview) = window.app_handle().get_webview_window("main") else {
                return;
            };
            match event {
                WindowEvent::Suspended => {
                    let _ = webview.with_webview(|platform| {
                        let url = unsafe { page_url(platform.inner().cast()) };
                        if url.is_some() {
                            *LAST_URL.lock().unwrap() = url;
                        }
                    });
                    take_snapshot(&webview);
                }
                WindowEvent::Resumed => {
                    std::thread::spawn(move || check(webview));
                }
                _ => {}
            }
        })
}

/// The WKWebView's URL. Not `WebviewWindow::url`, which misses the app's own
/// navigations (`history.pushState`) and stays on the URL it first loaded.
///
/// # Safety
/// `web_view` is a WKWebView, and this runs on the main thread.
unsafe fn page_url(web_view: *const AnyObject) -> Option<Url> {
    let url: Option<Retained<AnyObject>> = objc2::msg_send![web_view, URL];
    let text: Option<Retained<AnyObject>> = objc2::msg_send![url.as_deref()?, absoluteString];
    let utf8: *const std::ffi::c_char = objc2::msg_send![text.as_deref()?, UTF8String];
    let url = Url::parse(std::ffi::CStr::from_ptr(utf8).to_str().ok()?).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

/// The page's URL now, or else when the app left the foreground: after the
/// content process is gone, the web view may have none.
fn url_to_load<R: Runtime>(webview: &WebviewWindow<R>) -> Option<Url> {
    let (tx, rx) = mpsc::channel();
    let _ = webview.with_webview(move |platform| {
        let _ = tx.send(unsafe { page_url(platform.inner().cast()) });
    });
    let now = rx.recv_timeout(Duration::from_secs(1)).ok().flatten();
    now.or_else(|| LAST_URL.lock().unwrap().clone())
}

/// After a resume: keeps the page if it is still there, recovers it if not.
fn check<R: Runtime>(webview: WebviewWindow<R>) {
    if RECOVERING.load(Ordering::SeqCst) {
        return;
    }
    let server_up = webview
        .state::<AssetServer>()
        .wait_until_up(Duration::from_secs(5));
    if server_up && answers(&webview, PAGE_IS_THERE, Duration::from_secs(3)) {
        with_snapshot(&webview, |snapshot, _| {
            if let Some(view) = snapshot.take() {
                unsafe { remove(&view) };
            }
        });
    } else {
        recover(webview);
    }
}

/// Covers the web view with the snapshot, loads the page again once the asset
/// server is up, and uncovers it when the page is back where it was.
fn recover<R: Runtime>(webview: WebviewWindow<R>) {
    if RECOVERING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        with_snapshot(&webview, |snapshot, web_view| {
            if let Some(view) = snapshot.as_deref() {
                let _: () = unsafe { objc2::msg_send![web_view, addSubview: view] };
            }
        });
        if webview
            .state::<AssetServer>()
            .wait_until_up(Duration::from_secs(10))
        {
            let url = url_to_load(&webview);
            eprintln!("web view lost its page; loading {url:?} again");
            let _ = match url {
                Some(url) => webview.navigate(url),
                None => webview.reload(),
            };
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline
                && !answers(&webview, PAGE_IS_THERE, Duration::from_secs(1))
            {
                std::thread::sleep(Duration::from_millis(200));
            }
        } else {
            eprintln!("asset server is down; can't load the web view again");
        }
        with_snapshot(&webview, |snapshot, _| {
            if let Some(view) = snapshot.take() {
                unsafe { remove(&view) };
            }
        });
        RECOVERING.store(false, Ordering::SeqCst);
    });
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

/// Keeps a picture of the page in a UIImageView, ready to cover the web view.
/// A copy of the pixels: `snapshotViewAfterScreenUpdates:` shows the content
/// process's live layers, which go blank with the process.
fn take_snapshot<R: Runtime>(webview: &WebviewWindow<R>) {
    with_snapshot(webview, |snapshot, web_view| {
        if let Some(old) = snapshot.take() {
            unsafe { remove(&old) };
        }
        let done = block2::RcBlock::new(|image: *mut AnyObject, _error: *mut AnyObject| {
            let Some(image) = (unsafe { image.as_ref() }) else {
                return;
            };
            // WebKit calls this on the main thread. The view's frame is the
            // image's size, which is the web view's bounds.
            let view: Option<Retained<AnyObject>> = unsafe {
                let view: Allocated<AnyObject> =
                    objc2::msg_send![objc2::class!(UIImageView), alloc];
                objc2::msg_send![view, initWithImage: image]
            };
            SNAPSHOT.with(|snapshot| *snapshot.borrow_mut() = view);
        });
        let no_configuration: *const AnyObject = std::ptr::null();
        let _: () = unsafe {
            objc2::msg_send![
                web_view,
                takeSnapshotWithConfiguration: no_configuration,
                completionHandler: &*done
            ]
        };
    });
}

/// Runs `f` on the main thread with the stored snapshot and the WKWebView.
fn with_snapshot<R: Runtime>(
    webview: &WebviewWindow<R>,
    f: impl FnOnce(&mut Option<Retained<AnyObject>>, &AnyObject) + Send + 'static,
) {
    let _ = webview.with_webview(move |platform| {
        // `inner()` is the WKWebView, and `with_webview` runs this on the main thread.
        let web_view = unsafe { &*platform.inner().cast::<AnyObject>() };
        SNAPSHOT.with(|snapshot| f(&mut snapshot.borrow_mut(), web_view));
    });
}

unsafe fn remove(view: &AnyObject) {
    let _: () = objc2::msg_send![view, removeFromSuperview];
}
