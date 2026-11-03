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

/** Height in px of the fixed mobile formatting toolbar (#790). */
export const MOBILE_TOOLBAR_HEIGHT = 65;

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
