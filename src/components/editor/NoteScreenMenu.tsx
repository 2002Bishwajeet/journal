import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { History, List, MoreHorizontal, Search } from 'lucide-react';
import { useDotYouClientContext } from '@/components/auth';
import ConfirmDialog from '@/components/modals/ConfirmDialog';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import type { ContextMenuItemConfig } from '@/components/ui/context-menu-wrapper';
import { buildNoteMenuItems } from '@/helpers/noteMenuItems';
import type { NoteScreenActions } from '@/hooks/useNoteScreenActions';
import { useNotes } from '@/hooks/useNotes';
import { extractHeadings } from '@/lib/editor/extractHeadings';
import type { NoteListEntry } from '@/types';
import { ContentsSheet } from './ContentsSheet';

/**
 * The More button of the note screen on touch layouts (#825): every action of the note in an
 * action sheet. The items are the note list row's (`buildNoteMenuItems`) plus the editor's own.
 */
export function NoteScreenMenu({
  note,
  isPeerNote,
  editor,
  actions,
  onOpenHistory,
}: {
  note: NoteListEntry;
  isPeerNote: boolean;
  editor: Editor | null;
  actions: NoteScreenActions;
  /** Not given for a note from someone else: a restore would replace their whole note. */
  onOpenHistory?: () => void;
}) {
  const dotYouClient = useDotYouClientContext();
  const { togglePin } = useNotes();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // An item opens a dialog, a sheet or the find bar, each of which owns a history entry
  // or takes focus. Run it once this sheet has closed: its entry is gone and Radix has
  // returned focus, which would otherwise take it back from the find bar.
  const afterClose = useRef<(() => void) | null>(null);
  const onCloseAutoFocus = (event: Event) => {
    const run = afterClose.current;
    if (!run) return;
    afterClose.current = null;
    event.preventDefault();
    run();
  };

  // Whether the note has headings as it is when the sheet opens; kept while the sheet slides away.
  const [hasHeadings, setHasHeadings] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (sheetOpen !== wasOpen) {
    setWasOpen(sheetOpen);
    if (sheetOpen) setHasHeadings(!!editor && !editor.isDestroyed && extractHeadings(editor.state.doc).length > 0);
  }
  const extra: ContextMenuItemConfig[] = [
    ...(editor
      ? [{ label: 'Find in note', icon: Search, action: () => editor.chain().openFind().run() }]
      : []),
    ...(hasHeadings ? [{ label: 'Contents', icon: List, action: () => setContentsOpen(true) }] : []),
    ...(onOpenHistory ? [{ label: 'Version history', icon: History, action: onOpenHistory }] : []),
  ];

  const items = buildNoteMenuItems(note, {
    isPeerNote,
    dotYouRoot: dotYouClient.getRoot(),
    handlers: {
      onTogglePin: (docId, isPinned) => togglePin.mutate({ docId, isPinned }),
      onShare: actions.onShare,
      onMoveToFolder: actions.onMoveToFolder,
      onRemoveFromList: actions.onRemoveFromList,
      onArchive: actions.onArchive,
      // The trash confirm stays a centred alert.
      onTrash: () => setTrashOpen(true),
    },
    extra,
  }).map((item) => ({
    ...item,
    action: () => {
      afterClose.current = item.action;
    },
  }));

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="More"
        className="h-11 w-11 -mr-2 shrink-0"
        onClick={() => setSheetOpen(true)}
      >
        <MoreHorizontal className="h-5 w-5" />
      </Button>
      <ActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={note.title || 'Untitled'}
        items={items}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      {editor && <ContentsSheet editor={editor} open={contentsOpen} onOpenChange={setContentsOpen} />}
      <ConfirmDialog
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        onConfirm={() => actions.onTrash(note.docId)}
        title="Move to Trash?"
        description="This note will be moved to Trash. You can restore it from there."
        confirmText="Move to Trash"
      />
    </>
  );
}
