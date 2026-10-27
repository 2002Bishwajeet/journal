import { useState } from 'react';
import { flushSync } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRestoreEditorFocus } from '@/hooks/useRestoreEditorFocus';
import { applyLink, getLinkTarget, removeLink } from '@/lib/editor/editorLink';

/** Add, edit or remove a link: a bottom sheet on touch layouts, a dialog on desktop (#827). */
export function LinkSheet({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const onCloseAutoFocus = useRestoreEditorFocus(editor, open);
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Link"
      onCloseAutoFocus={onCloseAutoFocus}
      dialogClassName="sm:max-w-md"
    >
      <LinkForm editor={editor} onDone={() => onOpenChange(false)} />
    </ResponsiveSheet>
  );
}

// Mounts when the sheet opens, so it reads the link and the selection once, at that moment.
function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [target] = useState(() => getLinkTarget(editor));
  const [text, setText] = useState(target.text);
  const [url, setUrl] = useState(target.href);
  const editing = target.href !== '';
  // Close, then focus the note inside the tap: iOS brings the keyboard back only for a focus
  // in a user gesture, and the close-time focus comes after the exit animation. flushSync
  // drops the sheet's focus trap first, which would pull the focus back.
  const finish = () => {
    flushSync(onDone);
    editor.commands.focus();
  };

  return (
    // noValidate: type=url would reject a bare host (example.com), which applyLink makes https://.
    <form
      noValidate
      className="flex flex-col gap-3 pb-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        applyLink(editor, target, text, url);
        finish();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-link-text">Text</Label>
        <Input
          id="editor-link-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="next"
          className="h-11 md:h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-link-url">URL</Label>
        <Input
          id="editor-link-url"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="flex gap-2 pt-1 max-sm:flex-col-reverse sm:justify-end">
        {editing && (
          <Button
            type="button"
            variant="outline"
            className="max-sm:h-11"
            onClick={() => {
              removeLink(editor, target);
              finish();
            }}
          >
            Remove link
          </Button>
        )}
        <Button type="submit" className="max-sm:h-11" disabled={!url.trim()}>
          Done
        </Button>
      </div>
    </form>
  );
}
