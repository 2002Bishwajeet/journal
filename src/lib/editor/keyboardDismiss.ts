/** How far in px the finger has to move down before the drag closes the keyboard. */
export const DISMISS_DRAG_DISTANCE = 48;
/** Movement in px below which a touch is still a tap or a press. */
export const DISMISS_DRAG_SLOP = 10;
/** A finger held this long in ms before it moves is selecting text, not scrolling. */
export const LONG_PRESS_MS = 500;

/**
 * Whether a one-finger drag on the note closes the keyboard, as dragging the
 * content down does in Apple Notes. `dx`/`dy` is the movement since the touch
 * started (down is positive); `heldMs` is how long the finger stayed within
 * DISMISS_DRAG_SLOP before it moved.
 */
export function isDismissDrag(dx: number, dy: number, heldMs: number): boolean {
  return heldMs < LONG_PRESS_MS && dy >= DISMISS_DRAG_DISTANCE && dy > Math.abs(dx) * 2;
}

/** Where a drag never closes the keyboard: the toolbar, sheets, and blocks that scroll or pan on their own. */
const NO_DISMISS_SELECTOR =
  "[data-mobile-toolbar], [data-slot='sheet-content'], [data-radix-popper-content-wrapper], pre, table, [data-live-block], iframe";

export function canStartDismissDrag(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest(NO_DISMISS_SELECTOR);
}
