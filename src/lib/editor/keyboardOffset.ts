/**
 * Distance in px between the bottom of the layout viewport and the top of the
 * on-screen keyboard (#789).
 *
 * - Layout resized for the keyboard (Android WebView, Firefox, `interactive-widget=resizes-content`):
 *   the visual viewport fills the layout viewport, so the offset is 0 and `bottom: 0` is right.
 * - Only the visual viewport shrank (iOS Safari): the offset is the keyboard height.
 *   iOS can also scroll the visual viewport inside the layout viewport (`offsetTop`), which moves the keyboard top.
 */
export function getKeyboardOffset(
  layoutHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
): number {
  return Math.max(0, layoutHeight - (viewportOffsetTop + viewportHeight));
}

/**
 * The part of `visualViewport.offsetTop` that is still inside the layout viewport.
 * The iOS app's WebKit view (WKWebView) shrinks `innerHeight` by the amount the page
 * scrolls for the keyboard, so that scroll is already outside the layout viewport and
 * must not be counted twice. In Safari `clientHeight` equals `innerHeight`, so this
 * returns `offsetTop` unchanged.
 */
export function getLayoutOffsetTop(offsetTop: number, clientHeight: number, innerHeight: number): number {
  const shrink = clientHeight - innerHeight;
  return shrink > 0 ? Math.max(0, offsetTop - shrink) : offsetTop;
}

/** Height in px of the floating mobile formatting toolbar: 48px buttons, 4px padding, 1px border (#790). */
export const MOBILE_TOOLBAR_HEIGHT = 58;

/** Gap in px between the floating toolbar and the keyboard (or the bottom of the screen). */
export const MOBILE_TOOLBAR_GAP = 8;

/** Gap in px kept between the caret line and the toolbar or keyboard (#790). */
export const CARET_CLEARANCE = 16;

/**
 * How far in px to scroll the editor container down so the caret line ends
 * `CARET_CLEARANCE` above whatever covers the bottom: the container edge, the
 * visual viewport (keyboard) or the toolbar. 0 when the caret is already clear (#790).
 */
export function getCaretScrollDelta(
  caretBottom: number,
  containerBottom: number,
  viewportBottom: number,
  toolbarTop: number | null,
): number {
  const limit = Math.min(containerBottom, viewportBottom, toolbarTop ?? Infinity) - CARET_CLEARANCE;
  return Math.max(0, caretBottom - limit);
}

/**
 * Scrolls the note so the caret line ends CARET_CLEARANCE above the toolbar and
 * the keyboard (#790). Returns whether it scrolled. Runs when ProseMirror scrolls
 * to the selection, and again whenever the keyboard moves: opening the keyboard
 * changes nothing in the editor, and iOS then scrolls the page only far enough to
 * clear the keyboard, which leaves the caret behind the toolbar.
 */
export function scrollCaretAboveKeyboard(editorDom: HTMLElement): boolean {
  const scroller = editorDom.closest<HTMLElement>(".overflow-y-auto");
  const selection = window.getSelection();
  if (!scroller || !selection?.rangeCount || !editorDom.contains(selection.anchorNode)) return false;
  // The range rect spans the line; an empty line has none, so use its block.
  const range = selection.getRangeAt(0);
  const lineRect =
    range.getClientRects()[0] ??
    (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.getBoundingClientRect();
  if (!lineRect) return false;
  const viewport = window.visualViewport;
  const delta = getCaretScrollDelta(
    lineRect.bottom,
    scroller.getBoundingClientRect().bottom,
    viewport
      ? getLayoutOffsetTop(viewport.offsetTop, document.documentElement.clientHeight, window.innerHeight) + viewport.height
      : window.innerHeight,
    document.querySelector("[data-mobile-toolbar]")?.getBoundingClientRect().top ?? null,
  );
  if (delta === 0) return false;
  scroller.scrollTop += Math.ceil(delta); // whole px: scrollTop rounds to the device pixel
  return true;
}
