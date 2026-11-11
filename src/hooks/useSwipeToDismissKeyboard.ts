import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { canStartDismissDrag, DISMISS_DRAG_SLOP, isDismissDrag } from "@/lib/editor/keyboardDismiss";

/**
 * While `enabled`, a deliberate one-finger drag down on the note closes the
 * keyboard, like Apple Notes. Small scrolls, upward or sideways drags, long
 * presses, pinches and drags that start in the toolbar or a code block, table
 * or live block leave it open.
 */
export function useSwipeToDismissKeyboard(editor: Editor, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const scroller = editor.view.dom.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return;
    let drag: { x: number; y: number; t: number; heldMs: number | null } | null = null;

    const onStart = (e: TouchEvent) => {
      const selection = window.getSelection();
      drag =
        e.touches.length === 1 && canStartDismissDrag(e.target) && (selection?.isCollapsed ?? true)
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp, heldMs: null }
          : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!drag) return;
      if (e.touches.length !== 1) {
        drag = null;
        return;
      }
      const dx = e.touches[0].clientX - drag.x;
      const dy = e.touches[0].clientY - drag.y;
      if (drag.heldMs === null && Math.hypot(dx, dy) > DISMISS_DRAG_SLOP) drag.heldMs = e.timeStamp - drag.t;
      if (drag.heldMs !== null && isDismissDrag(dx, dy, drag.heldMs)) {
        drag = null;
        editor.commands.blur();
      }
    };
    const onEnd = () => {
      drag = null;
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: true });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onEnd);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
    };
  }, [editor, enabled]);
}
