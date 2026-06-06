import { memo } from "react";
import { FileText, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { NoteListEntry } from "@/types";

export interface HiddenNoteRowAction {
  icon: LucideIcon;
  label: string;
  onClick: (docId: string) => void;
  destructive?: boolean;
}

interface HiddenNotesViewProps {
  /** Heading shown at the top (e.g. "Trash", "Archive"). */
  title: string;
  notes: NoteListEntry[];
  isLoading?: boolean;
  /** Icon + copy shown when the list is empty. */
  emptyIcon: LucideIcon;
  emptyLabel: string;
  /** Per-note action buttons (e.g. Restore, Delete forever). */
  rowActions: HiddenNoteRowAction[];
  /** Optional header action (e.g. "Empty Trash"); disabled when the list is empty. */
  headerAction?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * Generic management list for notes that are hidden from the main list
 * (Trash, Archive). Actions are fully configured by the caller.
 */
function HiddenNotesViewComponent({
  title,
  notes,
  isLoading,
  emptyIcon: EmptyIcon,
  emptyLabel,
  rowActions,
  headerAction,
  className,
}: HiddenNotesViewProps) {
  return (
    <div className={cn("flex flex-col h-full w-full min-w-0", className)}>
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
        <span className="text-sm font-medium">{title}</span>
        {headerAction && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={headerAction.onClick}
            disabled={notes.length === 0}
          >
            {headerAction.label}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : notes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground p-6 text-center">
          <EmptyIcon className="h-8 w-8 opacity-40" />
          <p className="text-sm">{emptyLabel}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul>
            {notes.map((note) => (
              <li
                key={note.docId}
                className="flex items-start gap-2 px-3 py-3 border-b border-border/50"
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}
              >
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground/60 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{note.title || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {note.preview || "No content"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {rowActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Button
                        key={action.label}
                        variant="ghost"
                        size="icon"
                        aria-label={action.label}
                        className={cn(
                          "h-7 w-7",
                          action.destructive && "text-destructive hover:text-destructive"
                        )}
                        onClick={() => action.onClick(note.docId)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </Button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

export const HiddenNotesView = memo(HiddenNotesViewComponent);
