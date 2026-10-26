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
