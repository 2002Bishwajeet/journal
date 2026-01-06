import { X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabInfo } from "@/hooks/useTabManager";

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onTabClick: (docId: string) => void;
  onTabClose: (docId: string) => void;
  className?: string;
}

export default function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
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
      {tabs.map((tab) => (
        <div
          key={tab.docId}
          className={cn(
            "group flex items-center gap-1.5 px-3 h-full border-r border-border cursor-pointer",
            "hover:bg-muted/50 transition-colors min-w-0 max-w-45",
            tab.docId === activeTabId
              ? "bg-background border-b-2 border-b-primary"
              : "bg-transparent"
          )}
          onClick={() => onTabClick(tab.docId)}
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs truncate flex-1 min-w-0">
            {tab.title || "Untitled"}
            {tab.isDirty && <span className="text-primary ml-1">•</span>}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.docId);
            }}
            className={cn(
              "h-4 w-4 rounded flex items-center justify-center shrink-0",
              "opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-all",
              tab.docId === activeTabId && "opacity-50 group-hover:opacity-100"
            )}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
