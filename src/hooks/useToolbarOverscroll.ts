import { useEffect, type RefObject } from "react";
import { getOverscroll, getStretch, rubberBand, springEasing } from "@/lib/editor/toolbarOverscroll";

const SPRING = springEasing();

/**
 * While `enabled`, a drag past either end of the toolbar row rubber-bands the buttons
 * and stretches the capsule that way, and both spring back on release. Transforms
 * only, written straight to the two elements. Off with reduced motion: the row then
 * just stops at its ends.
 */
export function useToolbarOverscroll(
  enabled: boolean,
  rowRef: RefObject<HTMLElement | null>,
  capsuleRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const row = rowRef.current;
    const capsule = capsuleRef.current;
    if (!enabled || !row || !capsule || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Sizes are read once per touch, so nothing measures layout while the finger moves.
    let start: { x: number; scroll: number; max: number; width: number } | null = null;
    let last = 0;

    const set = (offset: number, transition: string) => {
      last = offset;
      for (const el of [row, capsule]) el.style.transition = transition;
      row.style.transform = offset ? `translateX(${offset}px)` : "";
      capsule.style.transform = offset ? `scaleX(${getStretch(offset, start?.width ?? 1)})` : "";
      // Stretch toward the pull: anchored on the side the finger moves away from.
      if (offset) capsule.style.transformOrigin = offset > 0 ? "left center" : "right center";
    };
    const onStart = (e: TouchEvent) => {
      start =
        e.touches.length === 1
          ? { x: e.touches[0].clientX, scroll: row.scrollLeft, max: row.scrollWidth - row.clientWidth, width: row.clientWidth }
          : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const offset = rubberBand(getOverscroll(e.touches[0].clientX - start.x, start.scroll, start.max), start.width);
      if (offset !== last) set(offset, "none");
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      if (last) set(0, `transform ${SPRING.ms}ms ${SPRING.easing}`);
    };

    row.addEventListener("touchstart", onStart, { passive: true });
    row.addEventListener("touchmove", onMove, { passive: true });
    row.addEventListener("touchend", onEnd);
    row.addEventListener("touchcancel", onEnd);
    return () => {
      row.removeEventListener("touchstart", onStart);
      row.removeEventListener("touchmove", onMove);
      row.removeEventListener("touchend", onEnd);
      row.removeEventListener("touchcancel", onEnd);
      set(0, "");
    };
  }, [enabled, rowRef, capsuleRef]);
}
