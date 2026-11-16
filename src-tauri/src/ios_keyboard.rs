//! iOS: keeps the page still while the software keyboard opens (#1300).
//!
//! To show a focused field, WKWebView scrolls its own scroll view, which moves
//! the whole page and every top bar with it. `keepPageInPlace`
//! (src/lib/keyboardViewport.ts) scrolls it back, but only in the page's scroll
//! event, after WebKit's scroll animation has started, so the bar jumped for
//! 0.1-0.25 s. Here the scroll view's delegate puts the offset back in
//! `scrollViewDidScroll:`, which UIKit calls each time the offset changes, before
//! the frame is drawn, so no frame shows the scroll. The page's own containers
//! keep the field above the keyboard (`keepPageInPlace`, `scrollCaretAboveKeyboard`).
//!
//! Only a page that fits the web view is held: it has nothing to scroll. A page
//! taller than it (a public share page) or a pinch-zoomed one scrolls as before.

/// The offset to put the scroll view back to, or `None` to leave it. The page
/// fits when its content is no taller than the scroll view (1 pt for rounding);
/// its rest offset is the top inset, above zero. Only a scroll down from there
/// is undone: WebKit's reveal always scrolls down.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
fn held_offset(
    offset_y: f64,
    content_height: f64,
    view_height: f64,
    top_inset: f64,
) -> Option<f64> {
    let rest = -top_inset;
    (content_height <= view_height + 1.0 && offset_y > rest).then_some(rest)
}

#[cfg(target_os = "ios")]
pub use sys::hold_page;

#[cfg(target_os = "ios")]
mod sys {
    use std::cell::OnceCell;

    use objc2::encode::{Encode, Encoding};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, msg_send, AllocAnyThread};

    use super::held_offset;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UIEdgeInsets {
        top: f64,
        left: f64,
        bottom: f64,
        right: f64,
    }

    // SAFETY: the layouts above match CoreGraphics and UIKit on 64-bit iOS (CGFloat is f64).
    unsafe impl Encode for CGPoint {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for CGSize {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for CGRect {
        const ENCODING: Encoding =
            Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
    }
    unsafe impl Encode for UIEdgeInsets {
        const ENCODING: Encoding = Encoding::Struct("UIEdgeInsets", &[f64::ENCODING; 4]);
    }

    thread_local! {
        /// Main thread only. A scroll view holds its delegate weakly, so it's kept here.
        static HOLD: OnceCell<Retained<Hold>> = const { OnceCell::new() };
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and Hold doesn't implement Drop.
        #[unsafe(super(NSObject))]
        #[name = "JournalKeyboardHold"]
        struct Hold;

        impl Hold {
            #[unsafe(method(scrollViewDidScroll:))]
            fn scroll_view_did_scroll(&self, scroll_view: &AnyObject) {
                // SAFETY: UIKit passes the WKWebView's UIScrollView; these are its documented properties.
                unsafe {
                    let offset: CGPoint = msg_send![scroll_view, contentOffset];
                    let content: CGSize = msg_send![scroll_view, contentSize];
                    let bounds: CGRect = msg_send![scroll_view, bounds];
                    let inset: UIEdgeInsets = msg_send![scroll_view, adjustedContentInset];
                    if let Some(y) = held_offset(offset.y, content.height, bounds.size.height, inset.top) {
                        let _: () = msg_send![scroll_view, setContentOffset: CGPoint { x: offset.x, y }];
                    }
                }
            }
        }
    );

    impl Hold {
        fn new() -> Retained<Self> {
            let this = Self::alloc().set_ivars(());
            // SAFETY: NSObject's init.
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Makes `Hold` the delegate of the WKWebView's scroll view. WKWebView keeps its own
    /// delegate and forwards the calls to this one; wry sets none.
    ///
    /// # Safety
    ///
    /// `web_view` is the WKWebView (`PlatformWebview::inner`), on the main thread.
    pub unsafe fn hold_page(web_view: *mut AnyObject) {
        let scroll_view: Option<Retained<AnyObject>> = msg_send![&*web_view, scrollView];
        let Some(scroll_view) = scroll_view else {
            return;
        };
        HOLD.with(|hold| {
            let hold = hold.get_or_init(Hold::new);
            let _: () = msg_send![&scroll_view, setDelegate: &**hold];
        });
    }
}

#[cfg(test)]
mod tests {
    use super::held_offset;

    #[test]
    fn a_page_that_fits_goes_back_to_its_rest_offset() {
        // WebKit scrolls 192 pt to show the sign-in field.
        assert_eq!(held_offset(192.0, 874.0, 874.0, 0.0), Some(0.0));
        // Rounding in the content height.
        assert_eq!(held_offset(55.0, 874.4, 874.0, 0.0), Some(0.0));
        // With a top inset, rest is above zero.
        assert_eq!(held_offset(0.0, 874.0, 874.0, 62.0), Some(-62.0));
    }

    #[test]
    fn a_page_at_rest_or_pulled_down_is_left() {
        assert_eq!(held_offset(0.0, 874.0, 874.0, 0.0), None);
        assert_eq!(held_offset(-62.0, 874.0, 874.0, 62.0), None);
        assert_eq!(held_offset(-20.0, 874.0, 874.0, 0.0), None);
    }

    #[test]
    fn a_taller_or_zoomed_page_scrolls() {
        // A public share page.
        assert_eq!(held_offset(300.0, 2400.0, 874.0, 0.0), None);
        // Pinch zoom makes the content taller than the view.
        assert_eq!(held_offset(100.0, 1311.0, 874.0, 0.0), None);
    }
}
