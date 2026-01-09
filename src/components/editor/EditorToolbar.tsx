/**
 * Editor Toolbar Component
 * 
 * Desktop toolbar with formatting controls.
 * Uses shared useToolbarState for optimized re-renders.
 */

import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListTodo,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
  Sigma,
  PenTool,
} from 'lucide-react';
import { ToolbarButton, ToolbarDivider, ToolbarPopover, useToolbarState, safeEditorCommand } from './shared';
import { undo, redo } from './plugins/collaboration';
import { EmojiPicker } from './EmojiPicker';
import { TablePicker } from './TablePicker';

interface EditorToolbarProps {
  editor: Editor;
}

export default function EditorToolbar({ editor }: EditorToolbarProps) {
  const iconSize = 18;
  const state = useToolbarState(editor);

  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          if (result) {
            safeEditorCommand(editor, () => {
              editor.chain().focus().setImage({ src: result }).run();
            });
          }
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };



  return (
    <div className="flex items-center gap-0.5 px-4 py-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      {/* Undo/Redo - uses Y.js undo manager */}
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => {
          undo(editor.state);
          editor.view.focus();
        })}
        title="Undo (Cmd+Z)"
      >
        <Undo size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => {
          redo(editor.state);
          editor.view.focus();
        })}
        title="Redo (Cmd+Shift+Z)"
      >
        <Redo size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Text formatting */}
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleBold().run())}
        isActive={state.isBold}
        title="Bold (Cmd+B)"
      >
        <Bold size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleItalic().run())}
        isActive={state.isItalic}
        title="Italic (Cmd+I)"
      >
        <Italic size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleStrike().run())}
        isActive={state.isStrike}
        title="Strikethrough (Cmd+Shift+X)"
      >
        <Strikethrough size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run())}
        isActive={state.isCode}
        title="Inline Code (Cmd+E)"
      >
        <Code size={iconSize} />
      </ToolbarButton>

      <ToolbarPopover
        icon={<Sigma size={iconSize} />}
        title="Math Formula"
        placeholder="Enter LaTeX formula (e.g. E=mc^2)"
        onApply={(formula) => {
          safeEditorCommand(editor, () => {
            editor.chain().focus().insertContent(`$${formula}$`).run();
          });
        }}
      />

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        isActive={state.isHeading1}
        title="Heading 1"
      >
        <Heading1 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        isActive={state.isHeading2}
        title="Heading 2"
      >
        <Heading2 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        isActive={state.isHeading3}
        title="Heading 3"
      >
        <Heading3 size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleBulletList().run())}
        isActive={state.isBulletList}
        title="Bullet List (Cmd+Shift+8)"
      >
        <List size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleOrderedList().run())}
        isActive={state.isOrderedList}
        title="Numbered List (Cmd+Shift+7)"
      >
        <ListOrdered size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleTaskList().run())}
        isActive={state.isTaskList}
        title="Task List"
      >
        <ListTodo size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Block elements */}
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleBlockquote().run())}
        isActive={state.isBlockquote}
        title="Quote"
      >
        <Quote size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().setHorizontalRule().run())}
        title="Horizontal Rule"
      >
        <Minus size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Insert */}
      <ToolbarPopover
        icon={<LinkIcon size={iconSize} />}
        title="Add Link (Cmd+Shift+K)"
        isActive={state.isLink}
        placeholder="https://example.com"
        defaultValue={state.linkHref}
        onApply={(url) => {
          safeEditorCommand(editor, () => {
            editor.chain().focus().setLink({ href: url }).run();
          });
        }}
      />
      <ToolbarButton onClick={addImage} title="Add Image">
        <ImageIcon size={iconSize} />
      </ToolbarButton>
      <EmojiPicker editor={editor} />
      <TablePicker editor={editor} />
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().insertDrawing().run())}
        title="Insert Drawing Canvas"
      >
        <PenTool size={iconSize} />
      </ToolbarButton>
    </div>
  );
}
