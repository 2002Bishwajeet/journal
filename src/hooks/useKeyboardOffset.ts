import { useEffect } from "react";
import {
  getHeldKeyboardOffset,
  getKeyboardOffset,
  getLayoutOffsetTop,
  KEYBOARD_SETTLE_MS,
  MOBILE_TOOLBAR_GAP,
  MOBILE_TOOLBAR_HEIGHT,
  scrollCaretAboveKeyboard,
} from "@/lib/editor/keyboardOffset";

/**
 * The last software keyboard height seen on this page, per window width (portrait and
 * landscape keyboards differ). Android never reports one.
 */
const lastKeyboard = new Map<number, number>();

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * While `enabled`, writes the keyboard offset to `--keyboard-offset` and the
 * matching bottom padding to `--keyboard-safe-bottom` on the root element.
 * Writes happen in a requestAnimationFrame so React never re-renders per event (#789).
 * When the keyboard opens or changes height, the caret in `editorDom` is
 * scrolled clear of the toolbar again.
 * `cover` is a panel that stands in for the keyboard (the Aa style panel, #1272): the offset
 * is at least its height, so the toolbar and the end of the note stay above it.
 *
 * Focus moving into the note (or the Aa panel closing) starts the keyboard on its way up, but
 * iOS reports it ~150 ms later. Until then the last keyboard height is kept, so the toolbar
 * and the end of the note stay where the keyboard will be (#1272). With no height known yet,
 * iOS hides the toolbar until the keyboard arrives and fades it in there.
 */
export function useKeyboardOffset(enabled: boolean, editorDom: HTMLElement, cover: HTMLElement | null = null) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const rootStyle = document.documentElement.style;
    const startHeight = window.innerHeight;
    let frame = 0;
    let lastSize = "";
    let settling = true;
    let hidden = false;
    let lastOffset = -1;
    let transitionTimer = 0;
    const settleTimer = window.setTimeout(() => {
      settling = false;
      schedule();
    }, KEYBOARD_SETTLE_MS);

    const apply = () => {
      frame = 0;
      const keyboard = getKeyboardOffset(
        window.innerHeight,
        viewport?.height ?? window.innerHeight,
        getLayoutOffsetTop(viewport?.offsetTop ?? 0, document.documentElement.clientHeight, window.innerHeight),
      );
      const wasHolding = settling && lastOffset >= 0;
      // The keyboard arrived, or the layout resized for it (Android): nothing more to wait for.
      if (keyboard > 0 || window.innerHeight !== startHeight) settling = false;
      if (keyboard > 0) lastKeyboard.set(window.innerWidth, keyboard);
      const held = getHeldKeyboardOffset(keyboard, lastKeyboard.get(window.innerWidth) ?? null, settling);
      const offset = Math.max(cover?.offsetHeight ?? 0, held ?? 0);
      const hide = held === null && !cover && isIOS();

      // Coming out of a hold: fade the toolbar in, or ease it to the real inset.
      const transition =
        hidden && !hide ? "opacity" : wasHolding && !settling && Math.abs(offset - lastOffset) > 1 ? "bottom" : "";
      if (transition) {
        rootStyle.setProperty("--keyboard-transition", `${transition} var(--duration-fade) var(--ease-standard)`);
        clearTimeout(transitionTimer);
        transitionTimer = window.setTimeout(() => rootStyle.removeProperty("--keyboard-transition"), 250);
      }
      hidden = hide;
      lastOffset = offset;
      rootStyle.setProperty("--keyboard-toolbar-opacity", hide ? "0" : "1");

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
      clearTimeout(settleTimer);
      clearTimeout(transitionTimer);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      rootStyle.removeProperty("--keyboard-offset");
      rootStyle.removeProperty("--keyboard-safe-bottom");
      rootStyle.removeProperty("--editor-bottom-space");
      rootStyle.removeProperty("--keyboard-toolbar-opacity");
      rootStyle.removeProperty("--keyboard-transition");
    };
  }, [enabled, editorDom, cover]);
}
