import { useEffect, useRef } from "react";
import { swipeAxis } from "@/helpers/swipeAxis";
import { haptic } from "@/lib/haptics";

const minSwipeDistance = 50;
const maxSwipeDistance = 80;

// Moves a swiped row to `offset` px. While dragging, the CSS transition is off so
// the row follows the finger; on release it is back on for the snap.
function moveRow(
  content: HTMLElement | null,
  action: HTMLElement | null,
  offset: number,
  dragging: boolean,
) {
  if (!content || !action) return;
  const transition = dragging ? "none" : "";
  content.style.transition = transition;
  action.style.transition = transition;
  content.style.transform = `translateX(-${offset}px)`;
  action.style.transform = `translateX(${100 - (offset / maxSwipeDistance) * 100}%)`;
  action.style.opacity = String(Math.min(offset / minSwipeDistance, 1));
}

/**
 * A list row that a left swipe opens to show one 80 px action (#778): the swipe locks
 * to the horizontal axis, a tap outside closes it, and the caller keeps one row open.
 * Put `rowRef` on the row, `actionRef` on the action behind the content, and
 * `contentRef` plus `touchHandlers` on the content that slides.
 */
export function useSwipeRow(
  id: string,
  isSwiped: boolean,
  onSwipeChange: (id: string, open: boolean) => void,
) {
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  // The gesture lives in a ref: the drag writes the transform to the DOM, so a
  // touchmove does not re-render the row.
  const gesture = useRef<{
    x: number;
    y: number;
    axis: "x" | "y" | null;
    offset: number;
  } | null>(null);

  // Sync the row to the open state, so a close from outside animates too.
  useEffect(() => {
    moveRow(contentRef.current, actionRef.current, isSwiped ? maxSwipeDistance : 0, false);
  }, [isSwiped]);

  // A tap anywhere outside an open row closes it.
  useEffect(() => {
    if (!isSwiped) return;
    const closeOnOutsidePress = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) {
        onSwipeChange(id, false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isSwiped, id, onSwipeChange]);

  const onTouchStart = (e: React.TouchEvent) => {
    gesture.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      axis: null,
      offset: isSwiped ? maxSwipeDistance : 0,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g || g.axis === "y") return;
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;
    g.axis ??= swipeAxis(dx, dy);
    // Undecided yet, or a vertical scroll: leave the row alone until touchend.
    if (g.axis !== "x") return;

    const base = isSwiped ? maxSwipeDistance : 0;
    const raw = base - dx;
    const offset =
      raw > maxSwipeDistance
        ? Math.min(maxSwipeDistance + (raw - maxSwipeDistance) * 0.2, 100)
        : Math.max(raw, 0);
    g.offset = offset;
    moveRow(contentRef.current, actionRef.current, offset, true);
  };

  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.axis !== "x") return;

    const open = isSwiped
      ? g.offset > maxSwipeDistance - minSwipeDistance
      : g.offset > minSwipeDistance;
    moveRow(contentRef.current, actionRef.current, open ? maxSwipeDistance : 0, false);
    if (open !== isSwiped) {
      onSwipeChange(id, open);
      haptic(open ? "medium" : "light");
    }
  };

  return {
    rowRef,
    contentRef,
    actionRef,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
