import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { overlayEntryOpen } from "@/hooks/useOverlayHistory";
import { slideNavigate } from "@/lib/navDirection";
import { getMobileTab, TAB_ROOTS, type MobileTab } from "@/layouts/mobileTab";
import { createTabStacks } from "@/layouts/tabStacks";

/** Marks the entries a tab switch writes, so the stack tracking leaves them alone. */
const REBUILD = { tabRebuild: true };

/** The visible pane's list, scrolled back to its first row. */
function scrollListToTop() {
  const lists = document.querySelectorAll<HTMLElement>('[data-pane] [data-slot="scroll-area-viewport"]');
  [...lists].find((list) => list.offsetParent)?.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * The tab bar's two route tabs (#853) with a back stack each (#859). Every navigation inside
 * a tab updates that tab's stack. Switching tabs replaces the current history entry with the
 * target tab's first screen and pushes the rest, so Back walks that tab's own screens; the
 * active tab pops to its root. Back from a tab's first screen still goes to the previous
 * browser entry, which may belong to the other tab: a web page cannot stop there.
 */
export function useMobileTabs() {
  const location = useLocation();
  const { pathname, search } = location;
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const stacks = useRef(createTabStacks());
  const tracking = useRef({ started: false, afterOverlay: false });

  useEffect(() => {
    // A sheet's entry is never on a stack; closing it lands on the entry under it.
    if (overlayEntryOpen(location.state)) {
      tracking.current.afterOverlay = true;
      return;
    }
    const { started, afterOverlay } = tracking.current;
    tracking.current = { started: true, afterOverlay: false };
    const tab = getMobileTab(pathname);
    const here = pathname + search;
    const store = stacks.current;
    if (navigationType === "POP" || !started) {
      // Back, Forward or a first load (a reload or a deep link): follow the browser's entry.
      if (!store.popTo(tab, here)) {
        if (started) store.push(tab, here);
        else store.set(tab, [here]);
      }
    } else if ((location.state as typeof REBUILD | null)?.tabRebuild) {
      // A tab switch already wrote the stack.
    } else if (navigationType === "PUSH" || afterOverlay) {
      // A replace over a sheet's entry leaves the entry under it in history.
      store.push(tab, here);
    } else {
      store.replace(tab, here);
    }
  }, [location, pathname, search, navigationType]);

  const activeTab = getMobileTab(pathname);

  const selectTab = (tab: MobileTab) => {
    if (tab !== activeTab) {
      const [first, ...rest] = stacks.current.entries(tab);
      navigate(first, { replace: true, state: REBUILD });
      for (const entry of rest) navigate(entry, { state: REBUILD });
    } else if (pathname + search === TAB_ROOTS[tab]) {
      scrollListToTop();
    } else {
      stacks.current.set(tab, [TAB_ROOTS[tab]]);
      slideNavigate("back", () => navigate(TAB_ROOTS[tab], { replace: true, state: REBUILD }));
    }
  };

  return { activeTab, selectTab };
}
