/** Finger travel (px) before a touch gesture is read as horizontal or vertical. */
const AXIS_LOCK_DISTANCE = 10;

/**
 * Decide which axis a touch gesture follows, from its travel since touchstart.
 * Returns null until the finger has moved 10 px, then 'x' when the
 * move is mostly horizontal and 'y' otherwise. The caller keeps the first
 * answer until touchend.
 */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < AXIS_LOCK_DISTANCE) return null;
  return ax > ay ? 'x' : 'y';
}
