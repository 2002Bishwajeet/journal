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

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, Code, Link as LinkIcon, Strikethrough } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeEditorCommand } from './shared';

interface BubbleMenuToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title: string;
}

function ToolbarButton({ onClick, isActive, children, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded transition-colors",
        "hover:bg-accent active:bg-accent/80",
        "text-popover-foreground",
        isActive && "bg-accent text-accent-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function BubbleMenuToolbar({ editor }: BubbleMenuToolbarProps) {
  const iconSize = 16;
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

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
      
      // Get the bounding rect of the selection
      const view = editor.view;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      
      // Calculate center of selection
      const left = (start.left + end.left) / 2;
      const top = start.top - 50; // Position above the selection
      
      setPosition({ top, left });
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

  const toggleBold = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBold().run());
  }, [editor]);

  const toggleItalic = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleItalic().run());
  }, [editor]);

  const toggleStrike = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleStrike().run());
  }, [editor]);

  const toggleCode = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run());
  }, [editor]);

  const addLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl);
    
    if (url === null) return; // Cancelled
    
    if (url === '') {
      safeEditorCommand(editor, () => editor.chain().focus().unsetLink().run());
    } else {
      safeEditorCommand(editor, () => editor.chain().focus().setLink({ href: url }).run());
    }
  }, [editor]);

  if (!isVisible) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 px-2 py-1.5 bg-popover text-popover-foreground backdrop-blur-sm rounded-lg shadow-lg border border-border animate-in fade-in zoom-in-95 duration-150"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
      }}
      onMouseDown={(e) => e.preventDefault()} // Prevent losing selection
    >
      <ToolbarButton
        onClick={toggleBold}
        isActive={editor.isActive('bold')}
        title="Bold"
      >
        <Bold size={iconSize} />
      </ToolbarButton>
      
      <ToolbarButton
        onClick={toggleItalic}
        isActive={editor.isActive('italic')}
        title="Italic"
      >
        <Italic size={iconSize} />
      </ToolbarButton>
      
      <ToolbarButton
        onClick={toggleStrike}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough size={iconSize} />
      </ToolbarButton>
      
      <ToolbarButton
        onClick={toggleCode}
        isActive={editor.isActive('code')}
        title="Code"
      >
        <Code size={iconSize} />
      </ToolbarButton>
      
      <div className="w-px h-5 bg-border mx-1" />
      
      <ToolbarButton
        onClick={addLink}
        isActive={editor.isActive('link')}
        title="Link"
      >
        <LinkIcon size={iconSize} />
      </ToolbarButton>
    </div>
  );
}

export default BubbleMenuToolbar;

