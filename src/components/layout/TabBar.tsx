import { X, FileText, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabInfo } from "@/hooks/useTabManager";

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onTabClick: (docId: string) => void;
  onTabClose: (docId: string) => void;
  collaborativeTabIds?: Set<string>;
  className?: string;
}

export default function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  collaborativeTabIds,
  className,
}: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center h-9 bg-muted/30 border-b border-border overflow-x-auto scrollbar-thin",
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.docId === activeTabId;
        const tabTitle = tab.title || "Untitled";
        return (
          <div
            key={tab.docId}
            className={cn(
              "group relative flex items-center h-full border-r border-border min-w-0 max-w-45",
              "transition-colors",
              isActive
                ? "bg-background border-b-2 border-b-primary"
                : "bg-transparent hover:bg-muted/50"
            )}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onTabClose(tab.docId);
              }
            }}
          >
            {/* Tab activation button — the full clickable tab title area */}
            <button
              aria-label={tabTitle}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onTabClick(tab.docId)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-full min-w-0 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              )}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <span className="text-xs truncate flex-1 min-w-0">
                {tabTitle}
                {tab.isDirty && (
                  <>
                    <span className="text-primary ml-1" aria-hidden="true">•</span>
                    <span className="sr-only">unsaved changes</span>
                  </>
                )}
              </span>
              {collaborativeTabIds?.has(tab.docId) && (
                <>
                  <Users className="h-3 w-3 text-collaborative shrink-0 opacity-80" aria-hidden="true" />
                  <span className="sr-only">Collaborative note</span>
                </>
              )}
            </button>

            {/* Close button — sibling of activation button, not nested inside it */}
            <button
              onClick={() => onTabClose(tab.docId)}
              aria-label={`Close ${tabTitle}`}
              className={cn(
                "h-4 w-4 mr-1.5 rounded flex items-center justify-center shrink-0",
                "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
                "hover:bg-muted-foreground/20 transition-all",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                isActive && "opacity-50 group-hover:opacity-100 group-focus-within:opacity-100"
              )}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
