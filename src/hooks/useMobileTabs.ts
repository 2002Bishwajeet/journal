import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBackTo } from "@/hooks/useBackTo";
import { createTabMemory, getMobileTab, TAB_ROOTS, type MobileTab } from "@/layouts/mobileTab";

/** The visible pane's list, scrolled back to its first row. */
function scrollListToTop() {
  const lists = document.querySelectorAll<HTMLElement>('[data-pane] [data-slot="scroll-area-viewport"]');
  [...lists].find((list) => list.offsetParent)?.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * The tab bar's two route tabs (#853). The browser has one linear history, so a tab keeps
 * its last place in memory instead of its own stack: switching replaces the current entry
 * (Back still leaves the app from the root), and the active tab pops to its root.
 */
export function useMobileTabs() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const backTo = useBackTo();
  const memory = useRef(createTabMemory());

  useEffect(() => {
    memory.current.visit(pathname, search);
  }, [pathname, search]);

  const activeTab = getMobileTab(pathname);

  const selectTab = (tab: MobileTab) => {
    if (tab !== activeTab) navigate(memory.current.last(tab), { replace: true });
    else if (pathname + search === TAB_ROOTS[tab]) scrollListToTop();
    else backTo(TAB_ROOTS[tab]);
  };

  return { activeTab, selectTab };
}
