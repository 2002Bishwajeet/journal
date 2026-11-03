/**
 * Mobile Toolbar Component
 *
 * Sits on top of the keyboard on touch devices while the editor has focus.
 * Uses shared useToolbarState for optimized re-renders.
 *
 * Features:
 * - Safe area inset handling for notched devices (only while no keyboard is up)
 * - Larger touch targets (48px) for accessibility
 * - Comprehensive formatting options matching desktop
 */

import { useEffect, useState } from "react";
import { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
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
  Code,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardOffset } from "@/hooks/useKeyboardOffset";
import { useDeviceType } from "@/hooks/useDeviceType";
import { ToolbarButton, ToolbarDivider, useToolbarState, safeEditorCommand } from "./shared";
import { EmojiPicker } from "./EmojiPicker";
import { LinkSheet } from "./LinkSheet";
import { TablePicker } from "./TablePicker";
import { TextAlignPicker } from "./TextAlignPicker";
import { undo, redo } from "./plugins/collaboration";

interface MobileToolbarProps {
  editor: Editor;
  className?: string;
}

const V = "mobile" as const;

export default function MobileToolbar({
  editor,
  className,
}: MobileToolbarProps) {
  const [hasFocus, setHasFocus] = useState(() => editor.isFocused);
  const [linkOpen, setLinkOpen] = useState(false);

  // Use shared toolbar state hook
  const state = useToolbarState(editor);

  // Check if we're on a touch device
  const isTouchDevice =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;
  // On desktop widths (an iPad in landscape) the editor page shows the full toolbar at the top
  const isDesktop = useDeviceType() === "desktop";

  // Show while the editor (or a picker opened from this toolbar) has focus,
  // in every keyboard mode: the keyboard height is not a reliable signal.
  useEffect(() => {
    const inEditorUi = (target: EventTarget | null) =>
      target instanceof Element &&
      (editor.view.dom.contains(target) ||
        !!target.closest("[data-mobile-toolbar], [data-radix-popper-content-wrapper]"));
    // A sheet opened from the editor (link, emoji, table...) takes focus, but the toolbar that
    // holds its state has to stay: focus moving into or out of a sheet changes nothing (#827).
    const inSheet = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('[data-slot="sheet-content"]');
    const onFocusIn = (e: FocusEvent) => {
      if (!inSheet(e.target)) setHasFocus(inEditorUi(e.target));
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!inSheet(e.target) && !inSheet(e.relatedTarget)) setHasFocus(inEditorUi(e.relatedTarget));
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [editor]);

  const isVisible = isTouchDevice && !isDesktop && hasFocus;
  useKeyboardOffset(isVisible);

  // Action handlers using safeEditorCommand
  const handleUndo = () => {
    safeEditorCommand(editor, () => {
      undo(editor.state);
      editor.view.focus();
    });
  };

  const handleRedo = () => {
    safeEditorCommand(editor, () => {
      redo(editor.state);
      editor.view.focus();
    });
  };

  const toggleBold = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBold().run());
  };

  const toggleItalic = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleItalic().run(),
    );
  };

  const toggleUnderline = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleUnderline().run(),
    );
  };

  const toggleStrike = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleStrike().run(),
    );
  };

  const clearFormatting = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().clearNodes().unsetAllMarks().run(),
    );
  };

  const toggleBulletList = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleBulletList().run(),
    );
  };

  const toggleOrderedList = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleOrderedList().run(),
    );
  };

  const toggleTaskList = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleTaskList().run(),
    );
  };

  const toggleHeading1 = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
    );
  };

  const toggleHeading2 = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
    );
  };

  const toggleHeading3 = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
    );
  };

  const toggleHeading4 = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleHeading({ level: 4 }).run(),
    );
  };

  const toggleHeading5 = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleHeading({ level: 5 }).run(),
    );
  };

  const toggleHeading6 = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleHeading({ level: 6 }).run(),
    );
  };

  const toggleCode = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run());
  };

  const toggleBlockquote = () => {
    safeEditorCommand(editor, () =>
      editor.chain().focus().toggleBlockquote().run(),
    );
  };

  const addLink = () => setLinkOpen(true);

  const addImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      safeEditorCommand(editor, () =>
        editor.commands.insertImageFiles(Array.from(input.files ?? [])),
      );
    };
    input.click();
  };

  // Don't render on non-touch devices, at desktop widths or when the editor has no focus
  if (!isVisible) return null;

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg",
        className,
      )}
      data-mobile-toolbar
      style={{
        bottom: "var(--keyboard-offset, 0px)",
        paddingBottom: "var(--keyboard-safe-bottom, env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* The slash menu docks here, above the toolbar, while the editor keeps focus (#827) */}
      <div data-slash-dock className="absolute inset-x-0 bottom-full empty:hidden" />
      <LinkSheet editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
      {/* Scrollable toolbar container */}
      <div
        className="flex items-center gap-0.5 px-2 py-2 overflow-x-auto scrollbar-hide"
        style={{
          paddingLeft: "max(8px, env(safe-area-inset-left, 8px))",
          paddingRight: "max(8px, env(safe-area-inset-right, 8px))",
        }}
      >
        {/* Undo/Redo */}
        <ToolbarButton variant={V} onClick={handleUndo} title="Undo">
          <Undo className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V} onClick={handleRedo} title="Redo">
          <Redo className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider variant="mobile" />

        {/* Text formatting */}
        <ToolbarButton variant={V}
          onClick={toggleBold}
          isActive={state.isBold}
          title="Bold"
        >
          <Bold className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleItalic}
          isActive={state.isItalic}
          title="Italic"
        >
          <Italic className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleUnderline}
          isActive={state.isUnderline}
          title="Underline"
        >
          <Underline className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleStrike}
          isActive={state.isStrike}
          title="Strikethrough"
        >
          <Strikethrough className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleCode}
          isActive={state.isCode}
          title="Code"
        >
          <Code className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V} onClick={clearFormatting} title="Clear Formatting">
          <RemoveFormatting className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider variant="mobile" />

        {/* Headings */}
        <ToolbarButton variant={V}
          onClick={toggleHeading1}
          isActive={state.isHeading1}
          title="Heading 1"
        >
          <Heading1 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleHeading2}
          isActive={state.isHeading2}
          title="Heading 2"
        >
          <Heading2 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleHeading3}
          isActive={state.isHeading3}
          title="Heading 3"
        >
          <Heading3 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleHeading4}
          isActive={state.isHeading4}
          title="Heading 4"
        >
          <Heading4 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleHeading5}
          isActive={state.isHeading5}
          title="Heading 5"
        >
          <Heading5 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleHeading6}
          isActive={state.isHeading6}
          title="Heading 6"
        >
          <Heading6 className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider variant="mobile" />

        {/* Lists */}
        <ToolbarButton variant={V}
          onClick={toggleBulletList}
          isActive={state.isBulletList}
          title="Bullet List"
        >
          <List className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleOrderedList}
          isActive={state.isOrderedList}
          title="Numbered List"
        >
          <ListOrdered className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton variant={V}
          onClick={toggleTaskList}
          isActive={state.isTaskList}
          title="Task List"
        >
          <ListTodo className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider variant="mobile" />

        {/* Block elements */}
        <ToolbarButton variant={V}
          onClick={toggleBlockquote}
          isActive={state.isBlockquote}
          title="Quote"
        >
          <Quote className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider variant="mobile" />

        {/* Insert */}
        <ToolbarButton variant={V}
          onClick={addLink}
          isActive={state.isLink}
          title="Add Link"
        >
          <LinkIcon className="h-5 w-5" />
        </ToolbarButton>
        <EmojiPicker
          editor={editor}
          className="flex items-center justify-center w-12 h-12 min-w-12 rounded-lg transition-colors text-foreground hover:bg-muted active:bg-primary/20 touch-manipulation"
        />
        <ToolbarButton variant={V} onClick={addImage} title="Add Image">
          <ImageIcon className="h-5 w-5" />
        </ToolbarButton>
        <TablePicker editor={editor} />

        <ToolbarDivider variant="mobile" />

        <TextAlignPicker
          editor={editor}
          currentAlign={state.textAlign}
          className="flex items-center justify-center w-12 h-12 min-w-12 rounded-lg transition-colors text-foreground hover:bg-muted active:bg-primary/20 touch-manipulation"
          iconSize={20}
        />
      </div>
    </div>
  );
}
