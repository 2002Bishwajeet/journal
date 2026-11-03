import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
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
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        variant="full"
        title="Version history"
        description="History is saved on this device only."
        onCloseAutoFocus={focusEditor}
      >
        {!isLoading && snapshots.length === 0 && (
          <p className="text-sm text-muted-foreground">No earlier versions yet.</p>
        )}

        <ul className="max-h-96 overflow-y-auto divide-y divide-border in-data-[slot=sheet-body]:max-h-none">
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
      </ResponsiveSheet>

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
