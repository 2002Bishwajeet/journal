import { memo, useRef, useState } from "react";
import { ChevronLeft, FileText, MoreHorizontal, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActionSheet } from "@/components/ui/action-sheet";
import { ContextMenuWrapper, RowOptionsMenu, type ContextMenuItemConfig } from "@/components/ui/context-menu-wrapper";
import { ConfirmDialog } from "@/components/modals";
import { useLargeTitle } from "@/hooks/useLargeTitle";
import { useSwipeRow } from "@/hooks/useSwipeRow";
import { haptic } from "@/lib/haptics";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { NoteListEntry } from "@/types";
import { BarTitle, EmptyState, LargeTitle } from "./LargeTitle";
import { FILL_EMPTY_VIEWPORT, largeTitleBarClass } from "./largeTitleClasses";

export interface HiddenNoteRowAction {
  icon: LucideIcon;
  label: string;
  onClick: (docId: string) => void;
  destructive?: boolean;
  /** Ask first (one action at most): a dialog on desktop, a bottom sheet with `description` and a red `confirmText` button on compact. */
  confirm?: { title: string; description: string; confirmText: string };
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
  /** Per-note actions (e.g. Restore, Delete forever): row buttons on desktop; compact puts them in the row's sheet and swipes to the destructive one (#977). */
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
  // Compact: one swiped-open row at a time; it closes on scroll and on a tap outside it.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const handleSwipeChange = (id: string, open: boolean) =>
    setOpenRowId((cur) => (open ? id : cur === id ? null : cur));
  // The row action with `confirm` (Delete forever) runs only once its confirm is accepted.
  const confirmAction = rowActions.find((action) => action.confirm);
  const [confirmDocId, setConfirmDocId] = useState<string | null>(null);
  const actions = rowActions.map((action) => (action === confirmAction ? { ...action, onClick: setConfirmDocId } : action));
  const runConfirmed = () => confirmDocId && confirmAction?.onClick(confirmDocId);

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
            {actions.map((action) => {
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
        {/* Radix wraps the content in a display:table div that grows to the longest title; block keeps
            rows inside the screen. A finger scrolls with no scrollbar, as the platform's lists do. */}
        <ScrollArea
          className={cn(
            "flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block pointer-coarse:[&_[data-slot=scroll-area-scrollbar]]:hidden",
            isEmpty && FILL_EMPTY_VIEWPORT,
          )}
          onScrollCapture={() => setOpenRowId(null)}
        >
          {/* A tablet shows this list full width (#781): wider side margins, and no line longer than 60ch. */}
          <div className="flex h-full flex-col md:px-2">
            <LargeTitle titleRef={largeTitle.ref}>{title}</LargeTitle>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : isEmpty ? (
              <EmptyState icon={EmptyIcon} title={emptyLabel} description={emptyDescription} />
            ) : (
              <ul className="pb-[var(--fab-clearance,0px)]">
                {notes.map((note) => (
                  <HiddenNoteRow
                    key={note.docId}
                    note={note}
                    actions={actions}
                    isSwiped={openRowId === note.docId}
                    onSwipeChange={handleSwipeChange}
                  />
                ))}
              </ul>
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
        {confirmAction?.confirm && (
          <ActionSheet
            open={!!confirmDocId}
            onOpenChange={(open) => !open && setConfirmDocId(null)}
            title={confirmAction.confirm.title}
            message={confirmAction.confirm.description}
            items={[{ label: confirmAction.confirm.confirmText, variant: "destructive", action: runConfirmed }]}
          />
        )}
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
      {confirmAction?.confirm && (
        <ConfirmDialog
          isOpen={!!confirmDocId}
          onClose={() => setConfirmDocId(null)}
          onConfirm={runConfirmed}
          title={confirmAction.confirm.title}
          description={confirmAction.confirm.description}
          confirmText={confirmAction.confirm.confirmText}
        />
      )}
    </div>
  );
}

export const HiddenNotesView = memo(HiddenNotesViewComponent);

/**
 * A phone and tablet row (#977), like a note list row: one line each of title and preview
 * inside the 16 px gutter, when the note was last edited (no deletion date is kept), the
 * actions in a sheet from a long press or the … button, and a left swipe to the destructive one.
 */
function HiddenNoteRow({
  note,
  actions,
  isSwiped,
  onSwipeChange,
}: {
  note: NoteListEntry;
  actions: HiddenNoteRowAction[];
  isSwiped: boolean;
  onSwipeChange: (id: string, open: boolean) => void;
}) {
  const { rowRef, contentRef, actionRef, touchHandlers } = useSwipeRow(note.docId, isSwiped, onSwipeChange);
  const items: ContextMenuItemConfig[] = actions.map((action) => ({
    label: action.label,
    icon: action.icon,
    variant: action.destructive ? "destructive" : "default",
    action: () => action.onClick(note.docId),
  }));
  const swipeAction = actions.find((action) => action.destructive);
  const SwipeIcon = swipeAction?.icon;
  const edited = formatRelativeTime(note.metadata.timestamps.modified);

  return (
    <li>
      <div
        ref={rowRef}
        data-testid="hidden-note-row"
        className="relative overflow-hidden select-none [-webkit-touch-callout:none]"
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 76px" }}
        onClick={isSwiped ? () => onSwipeChange(note.docId, false) : undefined}
      >
        <ContextMenuWrapper items={items}>
          <div className="relative">
            {swipeAction && SwipeIcon && (
              <div
                ref={actionRef}
                className="absolute inset-y-0 right-0 w-20 bg-destructive text-destructive-foreground transition-[transform,opacity] duration-(--duration-fade) ease-(--ease-standard)"
                style={{ transform: "translateX(100%)", opacity: 0 }}
              >
                <button
                  type="button"
                  aria-label={swipeAction.label}
                  className="flex size-full items-center justify-center"
                  onClick={() => {
                    haptic("medium");
                    swipeAction.onClick(note.docId);
                  }}
                >
                  <SwipeIcon className="size-5" />
                </button>
              </div>
            )}
            <div
              ref={contentRef}
              {...touchHandlers}
              style={{ touchAction: "pan-y" }}
              className="relative flex items-center gap-2 bg-background py-3 pl-4 pr-1 transition-transform duration-(--duration-fade) ease-(--ease-standard) after:absolute after:inset-x-0 after:bottom-0 after:ml-4 after:h-px after:bg-border/60"
            >
              <div className="min-w-0 flex-1 md:[&>p]:max-w-[60ch]">
                <p className="truncate text-sm font-medium pointer-coarse:text-[15px] pointer-coarse:leading-5 pointer-coarse:font-semibold">{note.title || "Untitled"}</p>
                <p className="truncate text-xs text-muted-foreground pointer-coarse:text-[13px] pointer-coarse:leading-[18px]">{note.preview || "No content"}</p>
                {edited && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                    Edited {edited.replace("Just now", "just now")}
                  </p>
                )}
              </div>
              <RowOptionsMenu items={items} label="Note options" />
            </div>
          </div>
        </ContextMenuWrapper>
      </div>
    </li>
  );
}
