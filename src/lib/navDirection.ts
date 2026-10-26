import type { NavigateFunction } from "react-router-dom";

/**
 * Navigate back with a view transition that slides from the left on phones.
 * `data-nav="back"` on the root picks the slide direction in index.css.
 */
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function navigateBack(navigate: NavigateFunction, to: string): void {
  const root = document.documentElement;
  root.dataset.nav = "back";
  navigate(to, { viewTransition: true });
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => delete root.dataset.nav, 500);
}
