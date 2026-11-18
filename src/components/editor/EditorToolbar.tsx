/**
 * Editor Toolbar Component
 * 
 * Desktop toolbar with formatting controls.
 * Uses shared useToolbarState for optimized re-renders.
 */

import { Fragment } from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  RemoveFormatting,
  List,
  ListOrdered,
  ListTodo,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Quote,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
  Sigma,
  ListTree,
  History,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolbarButton, ToolbarDivider, ToolbarPopover, useToolbarState, safeEditorCommand } from './shared';
import { OverflowRow, type OverflowItem } from './shared/OverflowRow';
import { undo, redo } from './plugins/collaboration';
import { EmojiPicker } from './EmojiPicker';
import { TablePicker } from './TablePicker';
import { TextAlignPicker } from './TextAlignPicker';

interface EditorToolbarProps {
  editor: Editor;
  /** When provided, renders a desktop-only Table-of-contents toggle button. */
  onToggleToc?: () => void;
  tocOpen?: boolean;
  /** When provided, renders a Version history button. */
  onOpenHistory?: () => void;
  /** Narrow windows: items that do not fit go into a More menu, so the row neither wraps nor scrolls (#1392). */
  overflow?: boolean;
}

export default function EditorToolbar({ editor, onToggleToc, tocOpen = false, onOpenHistory, overflow = false }: EditorToolbarProps) {
  const iconSize = 18;
  const state = useToolbarState(editor);

  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      safeEditorCommand(editor, () => editor.commands.insertImageFiles(Array.from(input.files ?? [])));
    };
    input.click();
  };



  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, Icon: typeof Heading1, isActive: boolean): OverflowItem => ({
    key: `h${level}`,
    node: (
      <ToolbarButton
        onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level }).run())}
        isActive={isActive}
        title={`Heading ${level}`}
      >
        <Icon size={iconSize} />
      </ToolbarButton>
    ),
  });
  const divider = (key: string): OverflowItem => ({ key, node: <ToolbarDivider />, divider: true });

  const items: OverflowItem[] = [
    // Undo/Redo - uses Y.js undo manager
    {
      key: 'undo',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => {
            undo(editor.state);
            editor.view.focus();
          })}
          title="Undo (Cmd+Z)"
        >
          <Undo size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'redo',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => {
            redo(editor.state);
            editor.view.focus();
          })}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo size={iconSize} />
        </ToolbarButton>
      ),
    },
    ...(onOpenHistory
      ? [{
          key: 'history',
          node: (
            <ToolbarButton onClick={onOpenHistory} title="Version history">
              <History size={iconSize} />
            </ToolbarButton>
          ),
        }]
      : []),
    {
      key: 'find',
      node: (
        <ToolbarButton onClick={() => safeEditorCommand(editor, () => editor.chain().openFind().run())} title="Find in note (⌘F)">
          <Search size={iconSize} />
        </ToolbarButton>
      ),
    },
    divider('d1'),

    // Text formatting
    {
      key: 'bold',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleBold().run())}
          isActive={state.isBold}
          title="Bold (Cmd+B)"
        >
          <Bold size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'italic',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleItalic().run())}
          isActive={state.isItalic}
          title="Italic (Cmd+I)"
        >
          <Italic size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'underline',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleUnderline().run())}
          isActive={state.isUnderline}
          title="Underline (Cmd+U)"
        >
          <Underline size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'strike',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleStrike().run())}
          isActive={state.isStrike}
          title="Strikethrough (Cmd+Shift+X)"
        >
          <Strikethrough size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'code',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run())}
          isActive={state.isCode}
          title="Inline Code (Cmd+E)"
        >
          <Code size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'clear',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().clearNodes().unsetAllMarks().run())}
          title="Clear Formatting (Cmd+\)"
        >
          <RemoveFormatting size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'math',
      node: (
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
      ),
    },
    divider('d2'),

    // Headings
    heading(1, Heading1, state.isHeading1),
    heading(2, Heading2, state.isHeading2),
    heading(3, Heading3, state.isHeading3),
    heading(4, Heading4, state.isHeading4),
    heading(5, Heading5, state.isHeading5),
    heading(6, Heading6, state.isHeading6),
    divider('d3'),

    // Lists
    {
      key: 'bullet',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleBulletList().run())}
          isActive={state.isBulletList}
          title="Bullet List (Cmd+Shift+8)"
        >
          <List size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'ordered',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleOrderedList().run())}
          isActive={state.isOrderedList}
          title="Numbered List (Cmd+Shift+7)"
        >
          <ListOrdered size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'task',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleTaskList().run())}
          isActive={state.isTaskList}
          title="Task List"
        >
          <ListTodo size={iconSize} />
        </ToolbarButton>
      ),
    },
    divider('d4'),

    // Block elements
    {
      key: 'quote',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().toggleBlockquote().run())}
          isActive={state.isBlockquote}
          title="Quote"
        >
          <Quote size={iconSize} />
        </ToolbarButton>
      ),
    },
    {
      key: 'rule',
      node: (
        <ToolbarButton
          onClick={() => safeEditorCommand(editor, () => editor.chain().focus().setHorizontalRule().run())}
          title="Horizontal Rule"
        >
          <Minus size={iconSize} />
        </ToolbarButton>
      ),
    },
    divider('d5'),

    // Insert
    {
      key: 'link',
      node: (
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
      ),
    },
    {
      key: 'image',
      node: (
        <ToolbarButton onClick={addImage} title="Add Image">
          <ImageIcon size={iconSize} />
        </ToolbarButton>
      ),
    },
    { key: 'emoji', node: <EmojiPicker editor={editor} /> },
    { key: 'table', node: <TablePicker editor={editor} /> },
    divider('d6'),

    // Text Alignment
    { key: 'align', node: <TextAlignPicker editor={editor} currentAlign={state.textAlign} /> },

    // Table of contents toggle (desktop-only; provided by EditorPage)
    ...(onToggleToc
      ? [
          divider('d7'),
          { key: 'toc', node: <TocToggle open={tocOpen} onToggle={onToggleToc} /> },
        ]
      : []),
  ];

  const border = 'border-b border-gray-200 dark:border-gray-700';

  // A narrow window compacts the row into a More menu instead of scrolling it (#1392).
  if (overflow) {
    return <OverflowRow items={items} className={cn('flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden px-4 py-2', border)} />;
  }

  return (
    // One row that scrolls sideways (swipe, trackpad, shift+wheel) instead of wrapping in a narrow pane.
    // The popovers it opens portal to <body>, so the overflow never clips them. The edge fade is as wide as
    // the padding, so it only covers buttons while there is more to scroll to.
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn('flex items-center gap-0.5 overflow-x-auto overscroll-x-contain scrollbar-hide scroll-px-4 *:shrink-0 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)] px-4 py-2', border)}
    >
      {items.map((item) => (
        <Fragment key={item.key}>{item.node}</Fragment>
      ))}
    </div>
  );
}

/** The Table-of-contents toggle; also on its own above a read-only note, which has no toolbar (#1211). */
export function TocToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label="Table of contents"
      title="Table of contents"
      className={cn(
        'p-2 rounded-md transition-colors hover:bg-muted',
        open && 'bg-accent text-accent-foreground'
      )}
    >
      <ListTree size={18} />
    </button>
  );
}
