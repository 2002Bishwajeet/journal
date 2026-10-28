import { useSyncExternalStore } from "react";
import { getKeyboardOffset } from "@/lib/editor/keyboardOffset";

// iOS Safari shrinks only the visual viewport for the software keyboard. A pinch
// zoom shrinks it too, so only a viewport at 1x counts.
function isKeyboardOpen(): boolean {
  const viewport = window.visualViewport;
  if (!viewport || viewport.scale !== 1) return false;
  return getKeyboardOffset(window.innerHeight, viewport.height, viewport.offsetTop) > 1;
}

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** True while the software keyboard covers the bottom of the screen. */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, isKeyboardOpen, () => false);
}
