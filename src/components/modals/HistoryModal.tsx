import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ConfirmDialog from './ConfirmDialog';
import { useVersionHistory } from '@/hooks/useVersionHistory';
import { formatRelativeTime, isTouchDevice } from '@/lib/utils';

interface HistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor;
  docId: string;
}

export default function HistoryModal({ open, onOpenChange, editor, docId }: HistoryModalProps) {
  const { snapshots, isLoading, restore } = useVersionHistory(editor, docId, open, () => onOpenChange(false));
  const [confirmId, setConfirmId] = useState<number | null>(null);
  // Both dialogs hand focus back to the editor on close, so "press Cmd+Z to
  // undo" works right after a restore whichever of them unmounts last. On a
  // touch device that would open the on-screen keyboard, so focus stays put.
  const focusEditor = (e: Event) => {
    e.preventDefault();
    if (!isTouchDevice()) editor.view.focus();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onCloseAutoFocus={focusEditor}
          // Below sm: a full-height sheet, the list fills the space under the header.
          className="max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:flex max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:rounded-none max-sm:border-0 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>History is saved on this device only.</DialogDescription>
          </DialogHeader>

          {!isLoading && snapshots.length === 0 && (
            <p className="text-sm text-muted-foreground">No earlier versions yet.</p>
          )}

          <ul className="max-h-96 overflow-y-auto divide-y divide-border max-sm:max-h-none max-sm:min-h-0 max-sm:flex-1">
            {snapshots.map((snap) => (
              <li key={snap.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {formatRelativeTime(snap.createdAt)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {snap.wordCount} {snap.wordCount === 1 ? 'word' : 'words'}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {snap.preview || 'Empty note'}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="max-sm:h-11 max-sm:px-4" onClick={() => setConfirmId(snap.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId !== null) void restore(confirmId);
        }}
        title="Restore this version?"
        description={`The note's current content is replaced with this version. ${isTouchDevice() ? 'You can undo it.' : 'You can undo with Cmd+Z.'}`}
        confirmText="Restore"
        variant="default"
        onCloseAutoFocus={focusEditor}
      />
    </>
  );
}
