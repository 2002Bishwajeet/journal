import { memo, useRef, useState } from "react";
import { ChevronLeft, FileText, MoreHorizontal, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActionSheet } from "@/components/ui/action-sheet";
import { ConfirmDialog } from "@/components/modals";
import { useLargeTitle } from "@/hooks/useLargeTitle";
import { cn } from "@/lib/utils";
import type { NoteListEntry } from "@/types";
import { BarTitle, EmptyState, LargeTitle } from "./LargeTitle";
import { FILL_EMPTY_VIEWPORT, largeTitleBarClass } from "./largeTitleClasses";

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
  /** Phone and tablet: the sentence under the empty label (#830). */
  emptyDescription: string;
  /** Per-note action buttons (e.g. Restore, Delete forever). */
  rowActions: HiddenNoteRowAction[];
  /** Optional header action (e.g. "Empty Trash"), asked to confirm first; disabled when the list is empty. */
  headerAction?: { label: string; onClick: () => void; confirm: { title: string; description: string } };
  /** Phone and tablet (#830): a large title, and the header action in a More (…) action sheet. */
  compact?: boolean;
  /** Compact only: renders a leading back button. */
  onBack?: () => void;
  /** Accessible name of the Back button (the tablet one opens the folders). */
  backLabel?: string;
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
  emptyDescription,
  rowActions,
  headerAction,
  compact = false,
  onBack,
  backLabel = "Back to notes",
  className,
}: HiddenNotesViewProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The confirm owns a history entry: open it once the sheet has closed and popped its own.
  const confirmAfterClose = useRef(false);
  const largeTitle = useLargeTitle(compact);
  const isEmpty = !isLoading && notes.length === 0;

  const list = (
    <ul className="pb-[var(--fab-clearance,0px)]">
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
          <div className="flex items-center gap-1 pointer-coarse:gap-2 shrink-0">
            {rowActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.label}
                  variant="ghost"
                  size="icon"
                  aria-label={action.label}
                  className={cn(
                    "h-7 w-7 pointer-coarse:size-11",
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
  );

  const confirmDialog = headerAction && (
    <ConfirmDialog
      isOpen={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      onConfirm={headerAction.onClick}
      title={headerAction.confirm.title}
      description={headerAction.confirm.description}
      confirmText={headerAction.label}
    />
  );

  if (compact) {
    return (
      <div className={cn("flex flex-col h-full w-full min-w-0", className)}>
        <div className={cn(largeTitleBarClass(largeTitle.collapsed), "justify-between")}>
          {onBack && (
            <Button variant="ghost" size="icon" aria-label={backLabel} className="size-11 shrink-0" onClick={onBack}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <BarTitle show={largeTitle.collapsed}>{title}</BarTitle>
          {headerAction && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="More"
              className="size-11 shrink-0 ml-auto"
              onClick={() => setMoreOpen(true)}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          )}
        </div>
        <ScrollArea
          className={cn("flex-1 min-h-0", isEmpty && FILL_EMPTY_VIEWPORT)}
        >
          <div className="flex h-full flex-col">
            <LargeTitle titleRef={largeTitle.ref}>{title}</LargeTitle>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : isEmpty ? (
              <EmptyState icon={EmptyIcon} title={emptyLabel} description={emptyDescription} />
            ) : (
              list
            )}
          </div>
        </ScrollArea>
        {headerAction && (
          <ActionSheet
            open={moreOpen}
            onOpenChange={setMoreOpen}
            title={`${title} actions`}
            items={[
              {
                label: headerAction.label,
                icon: Trash2,
                variant: "destructive",
                disabled: notes.length === 0,
                action: () => {
                  confirmAfterClose.current = true;
                },
              },
            ]}
            onCloseAutoFocus={(event) => {
              if (!confirmAfterClose.current) return;
              confirmAfterClose.current = false;
              event.preventDefault();
              setConfirmOpen(true);
            }}
          />
        )}
        {confirmDialog}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full w-full min-w-0", className)}>
      <div className="flex items-center gap-2 h-12 px-3 border-b border-border shrink-0">
        <span className="text-sm font-medium flex-1 truncate">{title}</span>
        {headerAction && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive shrink-0 pointer-coarse:h-11"
            onClick={() => setConfirmOpen(true)}
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
          {list}
        </ScrollArea>
      )}
      {confirmDialog}
    </div>
  );
}

export const HiddenNotesView = memo(HiddenNotesViewComponent);
