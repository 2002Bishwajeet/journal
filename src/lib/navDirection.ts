// Phone push and pop (#779). React Router's <BrowserRouter> ignores the
// `viewTransition` navigate option, so in-app navigations start the view
// transition here and index.css slides it below `lg`: forward from the right,
// back (data-nav="back") from the left. The system Back and the iOS swipe
// (popstate) never come through here, so Safari's own swipe animation is the
// only one that plays for them.

let finishUpdate: (() => void) | undefined;

/** JournalLayout calls this once React has rendered a new location; the slide then animates to it. */
export function routeRendered(): void {
  finishUpdate?.();
  finishUpdate = undefined;
}

export function slideNavigate(direction: "forward" | "back", go: () => void): void {
  const root = document.documentElement;
  // Desktop keeps plain navigation; with reduced motion there is nothing to slide.
  if (!document.startViewTransition || matchMedia("(min-width: 768px), (prefers-reduced-motion: reduce)").matches) {
    go();
    return;
  }
  if (direction === "back") root.dataset.nav = "back";
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        finishUpdate = resolve;
        go();
        // Never hold the old screen if the location does not change.
        setTimeout(resolve, 500);
      }),
  );
  const clear = () => delete root.dataset.nav;
  transition.finished.then(clear, clear);
}
