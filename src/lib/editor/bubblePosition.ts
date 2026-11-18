/** Keeps the selection bubble fully inside the viewport (#1398). */

export const BUBBLE_MARGIN = 8;
const BUBBLE_GAP = 8;

interface BubblePlacement {
  /** Horizontal centre of the selection. */
  centerX: number;
  /** Top of the selection's first line, and bottom of its last. */
  selectionTop: number;
  selectionBottom: number;
  /** Measured size of the bubble. */
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Left/top of the bubble's box: centred on the selection, above it, clamped to
 * the viewport with a margin on every side. With no room above it flips below.
 * A bubble wider than the viewport pins to the left margin (it wraps instead).
 */
export function placeBubble(p: BubblePlacement): { left: number; top: number } {
  const maxLeft = p.viewportWidth - BUBBLE_MARGIN - p.width;
  const left = Math.max(BUBBLE_MARGIN, Math.min(p.centerX - p.width / 2, maxLeft));

  const above = p.selectionTop - BUBBLE_GAP - p.height;
  const below = p.selectionBottom + BUBBLE_GAP;
  let top = above >= BUBBLE_MARGIN ? above : below;
  top = Math.max(BUBBLE_MARGIN, Math.min(top, p.viewportHeight - BUBBLE_MARGIN - p.height));
  return { left, top };
}
