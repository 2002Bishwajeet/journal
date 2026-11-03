// A modal dialog's scroll lock (Radix's react-remove-scroll) cancels a sideways touchmove
// that nothing in the dialog can scroll. On an iPhone that also stops Safari's edge
// swipe-back, the system Back, so Settings could not be swiped back. While a dialog is open,
// a one-finger touch that starts at the left edge moves past the page's handlers; a tap
// there sends no touchmove and still works.

const EDGE_PX = 24;

/** Lets edge swipes reach Safari until the returned function is called. */
export function letEdgeSwipesThrough(): () => void {
  let edgeTouch: number | undefined;
  const start = (event: TouchEvent) => {
    const [touch] = event.touches;
    edgeTouch = event.touches.length === 1 && touch.clientX < EDGE_PX ? touch.identifier : undefined;
  };
  const move = (event: TouchEvent) => {
    if (edgeTouch !== undefined && event.touches.length === 1 && event.touches[0].identifier === edgeTouch) {
      event.stopImmediatePropagation();
    }
  };
  const options = { capture: true, passive: true };
  window.addEventListener('touchstart', start, options);
  window.addEventListener('touchmove', move, options);
  return () => {
    window.removeEventListener('touchstart', start, options);
    window.removeEventListener('touchmove', move, options);
  };
}
