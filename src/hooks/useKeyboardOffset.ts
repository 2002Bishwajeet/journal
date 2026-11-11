import { useEffect } from "react";
import {
  getKeyboardOffset,
  getLayoutOffsetTop,
  MOBILE_TOOLBAR_GAP,
  MOBILE_TOOLBAR_HEIGHT,
  scrollCaretAboveKeyboard,
} from "@/lib/editor/keyboardOffset";

/**
 * While `enabled`, writes the keyboard offset to `--keyboard-offset` and the
 * matching bottom padding to `--keyboard-safe-bottom` on the root element.
 * Writes happen in a requestAnimationFrame so React never re-renders per event (#789).
 * When the keyboard opens or changes height, the caret in `editorDom` is
 * scrolled clear of the toolbar again.
 */
export function useKeyboardOffset(enabled: boolean, editorDom: HTMLElement) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const rootStyle = document.documentElement.style;
    let frame = 0;
    let lastSize = "";

    const apply = () => {
      frame = 0;
      const offset = getKeyboardOffset(
        window.innerHeight,
        viewport?.height ?? window.innerHeight,
        getLayoutOffsetTop(viewport?.offsetTop ?? 0, document.documentElement.clientHeight, window.innerHeight),
      );
      rootStyle.setProperty("--keyboard-offset", `${offset}px`);
      // Room at the end of the note so the last line scrolls above the toolbar (#790).
      rootStyle.setProperty("--editor-bottom-space", `${offset + MOBILE_TOOLBAR_GAP + MOBILE_TOOLBAR_HEIGHT}px`);
      // The home-indicator area is behind the keyboard while it is up.
      rootStyle.setProperty(
        "--keyboard-safe-bottom",
        offset > 0 ? "0px" : "env(safe-area-inset-bottom, 0px)",
      );
      // Android resizes the layout instead, which leaves the offset at 0.
      const size = `${offset} ${window.innerHeight}`;
      if (size !== lastSize) {
        lastSize = size;
        scrollCaretAboveKeyboard(editorDom);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      rootStyle.removeProperty("--keyboard-offset");
      rootStyle.removeProperty("--keyboard-safe-bottom");
      rootStyle.removeProperty("--editor-bottom-space");
    };
  }, [enabled, editorDom]);
}
