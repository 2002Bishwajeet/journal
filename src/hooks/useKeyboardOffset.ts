import { useEffect } from "react";
import { getKeyboardOffset } from "@/lib/editor/keyboardOffset";

/**
 * While `enabled`, writes the keyboard offset to `--keyboard-offset` and the
 * matching bottom padding to `--keyboard-safe-bottom` on the root element.
 * Writes happen in a requestAnimationFrame so React never re-renders per event (#789).
 */
export function useKeyboardOffset(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const rootStyle = document.documentElement.style;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const offset = getKeyboardOffset(
        window.innerHeight,
        viewport?.height ?? window.innerHeight,
        viewport?.offsetTop ?? 0,
      );
      rootStyle.setProperty("--keyboard-offset", `${offset}px`);
      // The home-indicator area is behind the keyboard while it is up.
      rootStyle.setProperty(
        "--keyboard-safe-bottom",
        offset > 0 ? "0px" : "env(safe-area-inset-bottom, 0px)",
      );
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
    };
  }, [enabled]);
}
