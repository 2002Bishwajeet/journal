import { useLayoutEffect } from "react";
import { NotebookText, Search, Settings, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MobileTab } from "@/layouts/mobileTab";

const TABS: { id: MobileTab | "search" | "settings"; label: string; icon: LucideIcon }[] = [
  { id: "notes", label: "Notes", icon: NotebookText },
  { id: "shared", label: "Shared", icon: Users },
  { id: "search", label: "Search", icon: Search },
  { id: "settings", label: "Settings", icon: Settings },
];

/**
 * Phone only (#853): Notes and Shared are routes, Search and Settings open their sheets,
 * which render above this bar. While it is on screen, html[data-tab-bar] raises the New note
 * button above it and sets the room lists and toasts leave (see index.css).
 */
export function MobileTabBar({
  activeTab,
  onSelectTab,
  onSearch,
  onSettings,
}: {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
  onSearch: () => void;
  onSettings: () => void;
}) {
  // Before paint, so the New note button never shows one frame at the old height.
  useLayoutEffect(() => {
    document.documentElement.dataset.tabBar = "";
    return () => {
      delete document.documentElement.dataset.tabBar;
    };
  }, []);

  const press = (id: (typeof TABS)[number]["id"]) => {
    if (id === "search") onSearch();
    else if (id === "settings") onSettings();
    else onSelectTab(id);
  };

  return (
    <nav
      aria-label="Tabs"
      className="mobile-tab-bar fixed inset-x-0 bottom-0 z-40 flex bg-background/80 shadow-[0_-1px_0_0_var(--border)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur-md"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => press(id)}
            className={cn(
              "flex h-(--tab-bar-height) min-w-0 flex-1 flex-col items-center justify-center gap-0.5 outline-none select-none [-webkit-tap-highlight-color:transparent] active:opacity-60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-6" aria-hidden />
            <span className="text-[10px] leading-3 font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
