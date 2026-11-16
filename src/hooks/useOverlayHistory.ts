import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDeviceType } from "@/hooks/useDeviceType";

type OverlayState = { overlays?: string[] };

const stackOf = (state: unknown) => (state as OverlayState | null)?.overlays ?? [];

/** How many overlays own a history entry at or below the current one. */
export const overlayDepth = (state: unknown) => stackOf(state).length;

/** The current entry belongs to an open overlay, so navigating away from it should replace it. */
export const overlayEntryOpen = (state: unknown) => stackOf(state).length > 0;

// A navigation that replaced the rendered entry (picking a Search result) may not
// have rendered yet, since React Router updates the location in a transition;
// then there is no entry of ours to pop. MemoryRouter leaves history.state alone.
const entryReplaced = (key: string) => {
  const current = (window.history.state as { key?: string } | null)?.key;
  return current !== undefined && current !== key;
};

// The pushed entry renders in that transition too, so a quick Back (or a slow
// render) can pop it before the location ever shows it: the browser entry no
// longer lists the overlay. The page's first entry has an idx but no key.
const entryPopped = (id: string) => {
  const current = window.history.state as { idx?: number; usr?: unknown } | null;
  return current?.idx !== undefined && !stackOf(current.usr).includes(id);
};

// Whether each mounted overlay is open, by id. Layout effects run before every hook's
// effect, so an overlay opening sees one that closed in the same render.
const openById = new Map<string, boolean>();

// Below the desktop breakpoint an open overlay owns one history entry, so the
// system Back gesture closes it and stays on the same screen.
// idle -> pushing (entry requested) -> active (entry is the current location).
export function useOverlayHistory(open: boolean, close: () => void) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useDeviceType() === "desktop";
  const phase = useRef<"idle" | "pushing" | "active">("idle");

  const stack = stackOf(location.state);
  const inStack = stack.includes(id);
  const isTop = stack[stack.length - 1] === id;

  useLayoutEffect(() => {
    openById.set(id, open);
    return () => {
      openById.delete(id);
    };
  }, [id, open]);

  useEffect(() => {
    if (isDesktop) return;
    // The top entry belongs to an overlay that closed in this render and has yet to pop it
    // (Settings closing as its Unlock opens the paywall). Pushing now would put our entry
    // above it, and its Back, which lands later, would pop ours and close us: wait for its
    // pop to render (the new location renders this hook again).
    const topClosing = openById.get(stack[stack.length - 1]) === false;
    if (open && phase.current === "idle" && !topClosing) {
      phase.current = "pushing";
      const { pathname, search, hash } = location;
      navigate(
        { pathname, search, hash },
        { state: { ...location.state, overlays: [...stack, id] } },
      );
    } else if (phase.current === "pushing" && inStack) {
      phase.current = "active";
    } else if (phase.current === "pushing" && open && entryPopped(id)) {
      // System Back removed our entry before it rendered.
      phase.current = "idle";
      close();
    } else if (phase.current === "active" && !inStack) {
      // System Back removed our entry.
      phase.current = "idle";
      close();
    } else if (phase.current === "active" && !open && isTop && !entryReplaced(location.key)) {
      // Closed inside the app: pop our own entry.
      phase.current = "idle";
      navigate(-1);
    } else if (phase.current === "pushing" && !open) {
      phase.current = "idle";
    }
  });
}
