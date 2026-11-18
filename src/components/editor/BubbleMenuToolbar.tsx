/**
 * BubbleMenu Toolbar Component
 * 
 * A floating toolbar that appears when text is selected.
 * Provides basic formatting options available on any screen size,
 * regardless of keyboard state or device type.
 * 
 * Uses editor selection state for positioning instead of @tiptap/extension-bubble-menu
 * which doesn't export a React component in v3.
 */

import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, Underline, Code, Link as LinkIcon, Strikethrough, RemoveFormatting } from 'lucide-react';
import { ToolbarButton, safeEditorCommand } from './shared';
import { LinkSheet } from './LinkSheet';
import { useDesktopControls } from '@/hooks';
import { BUBBLE_MARGIN, placeBubble } from '@/lib/editor/bubblePosition';

interface BubbleMenuToolbarProps {
  editor: Editor;
}

const V = "bubble" as const;

export function BubbleMenuToolbar({ editor }: BubbleMenuToolbarProps) {
  const iconSize = 16;
  const [isVisible, setIsVisible] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [anchor, setAnchor] = useState({ centerX: 0, top: 0, bottom: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  
  // Only with a mouse or trackpad: a touch device uses the bottom toolbar (#1392)
  const isDesktop = useDesktopControls();

  // Update visibility and position based on selection
  useEffect(() => {
    const updatePosition = () => {
      const { selection } = editor.state;
      const { from, to } = selection;
      
      // Only show when there's an actual text selection (not just cursor)
      if (from === to || selection.empty) {
        setIsVisible(false);
        return;
      }
      
      // Don't show for node selections (images, tables, code blocks, etc.)
      // These are nodes where text formatting doesn't apply
      // Check if it's a NodeSelection by checking if it has a 'node' property
      if ('node' in selection) {
        setIsVisible(false);
        return;
      }
      
      // Also check if the selection is entirely within a non-text node
      const $from = selection.$from;
      const nodeType = $from.parent.type.name;
      const nonTextNodes = ['image', 'codeBlock', 'table', 'horizontalRule'];
      if (nonTextNodes.includes(nodeType)) {
        setIsVisible(false);
        return;
      }
      
      // Get the bounding rect of the selection
      const view = editor.view;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      
      // The bubble is placed (and clamped to the viewport) once it is measured
      setAnchor({ centerX: (start.left + end.left) / 2, top: start.top, bottom: end.bottom });
      setIsVisible(true);
    };

    // Listen for selection changes
    editor.on('selectionUpdate', updatePosition);
    editor.on('blur', () => setIsVisible(false));
    
    return () => {
      editor.off('selectionUpdate', updatePosition);
      editor.off('blur', () => setIsVisible(false));
    };
  }, [editor]);

  // Measure the rendered bubble and keep it inside the viewport (#1398). Written to the
  // element directly: it runs before paint, so there is no flash at the unclamped spot.
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    el.style.left = '0px';
    el.style.top = '0px';
    const { width, height } = el.getBoundingClientRect();
    const { left, top } = placeBubble({
      centerX: anchor.centerX,
      selectionTop: anchor.top,
      selectionBottom: anchor.bottom,
      width,
      height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor, isVisible, isDesktop]);

  const toggleBold = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBold().run());
  };

  const toggleItalic = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleItalic().run());
  };

  const toggleUnderline = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleUnderline().run());
  };

  const toggleStrike = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleStrike().run());
  };

  const clearFormatting = () => {
    safeEditorCommand(editor, () => editor.chain().focus().clearNodes().unsetAllMarks().run());
  };

  const toggleCode = () => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run());
  };

  const addLink = () => setLinkOpen(true);

  return (
    <>
      {isVisible && isDesktop && (
      <div
        ref={toolbarRef}
        className="fixed z-50 flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-popover text-popover-foreground backdrop-blur-sm rounded-lg shadow-lg border border-border animate-in fade-in zoom-in-95 duration-150"
        // Wraps rather than collapsing into a More menu: it is only 7 buttons, so it
        // overflows only in windows under ~280px, not worth a second menu.
        style={{ maxWidth: `calc(100vw - ${BUBBLE_MARGIN * 2}px)` }}
        onMouseDown={(e) => e.preventDefault()} // Prevent losing selection
      >
        <ToolbarButton variant={V}
          onClick={toggleBold}
          isActive={editor.isActive('bold')}
          title="Bold"
        >
          <Bold size={iconSize} />
        </ToolbarButton>
      
        <ToolbarButton variant={V}
          onClick={toggleItalic}
          isActive={editor.isActive('italic')}
          title="Italic"
        >
          <Italic size={iconSize} />
        </ToolbarButton>

        <ToolbarButton variant={V}
          onClick={toggleUnderline}
          isActive={editor.isActive('underline')}
          title="Underline"
        >
          <Underline size={iconSize} />
        </ToolbarButton>

        <ToolbarButton variant={V}
          onClick={toggleStrike}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough size={iconSize} />
        </ToolbarButton>
      
        <ToolbarButton variant={V}
          onClick={toggleCode}
          isActive={editor.isActive('code')}
          title="Code"
        >
          <Code size={iconSize} />
        </ToolbarButton>
      
        <div className="w-px h-5 bg-border mx-1" />
      
        <ToolbarButton variant={V}
          onClick={addLink}
          isActive={editor.isActive('link')}
          title="Link"
        >
          <LinkIcon size={iconSize} />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton variant={V}
          onClick={clearFormatting}
          title="Clear Formatting"
        >
          <RemoveFormatting size={iconSize} />
        </ToolbarButton>
      </div>
      )}
      {/* Outlives the menu: opening it blurs the editor, which hides the menu. */}
      <LinkSheet editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
    </>
  );
}

export default BubbleMenuToolbar;
