import { useEffect, useId, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDeviceType } from "@/hooks/useDeviceType";

type OverlayState = { overlays?: string[] };

const stackOf = (state: unknown) => (state as OverlayState | null)?.overlays ?? [];

// Below the desktop breakpoint an open overlay owns one history entry, so the
// system Back gesture closes it and stays on the same screen.
// idle -> pushing (entry requested) -> active (entry is the current location).
export function useOverlayHistory(open: boolean, close: () => void) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useDeviceType() === "desktop";
  const phase = useRef<"idle" | "pushing" | "active">("idle");
  const closeRef = useRef(close);
  closeRef.current = close;

  const stack = stackOf(location.state);
  const inStack = stack.includes(id);
  const isTop = stack[stack.length - 1] === id;

  useEffect(() => {
    if (isDesktop) return;
    if (open && phase.current === "idle") {
      phase.current = "pushing";
      const { pathname, search, hash } = location;
      navigate(
        { pathname, search, hash },
        { state: { ...location.state, overlays: [...stack, id] } },
      );
    } else if (phase.current === "pushing" && inStack) {
      phase.current = "active";
    } else if (phase.current === "active" && !inStack) {
      // System Back removed our entry.
      phase.current = "idle";
      closeRef.current();
    } else if (phase.current === "active" && !open && isTop) {
      // Closed inside the app: pop our own entry.
      phase.current = "idle";
      navigate(-1);
    } else if (phase.current === "pushing" && !open) {
      phase.current = "idle";
    }
  });
}
