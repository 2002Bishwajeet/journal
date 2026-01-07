/**
 * Mobile Toolbar Component
 * 
 * Appears above the keyboard on touch devices.
 * Uses shared useToolbarState for optimized re-renders.
 */

import { useEffect, useState, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolbarState, safeEditorCommand } from './shared';
import { EmojiPicker } from './EmojiPicker';

interface MobileToolbarProps {
  editor: Editor;
  className?: string;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, isActive, disabled, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center w-11 h-11 min-w-[44px] rounded-lg transition-colors",
        "active:bg-primary/20",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-foreground hover:bg-muted",
        disabled && "opacity-50"
      )}
    >
      {children}
    </button>
  );
}

export default function MobileToolbar({ editor, className }: MobileToolbarProps) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  
  // Use shared toolbar state hook
  const state = useToolbarState(editor);

  // Detect keyboard visibility using visualViewport API
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const windowHeight = window.innerHeight;
      const viewportHeight = viewport.height;
      const heightDiff = windowHeight - viewportHeight;
      
      if (heightDiff > 150) {
        setKeyboardHeight(heightDiff);
        setIsVisible(true);
      } else {
        setKeyboardHeight(0);
        setIsVisible(false);
      }
    };

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);
    handleResize();

    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  // Check if we're on a touch device
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Action handlers using safeEditorCommand
  const toggleBold = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBold().run());
  }, [editor]);

  const toggleItalic = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleItalic().run());
  }, [editor]);

  const toggleBulletList = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBulletList().run());
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleOrderedList().run());
  }, [editor]);

  const toggleHeading = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 1 }).run());
  }, [editor]);

  const toggleCode = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run());
  }, [editor]);

  const addLink = useCallback(() => {
    const url = window.prompt('Enter URL:');
    if (url) {
      safeEditorCommand(editor, () => editor.chain().focus().setLink({ href: url }).run());
    }
  }, [editor]);

  const addImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const src = e.target?.result as string;
          safeEditorCommand(editor, () => editor.chain().focus().setImage({ src }).run());
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [editor]);

  // Don't render on non-touch devices or when keyboard is not visible
  if (!isTouchDevice || !isVisible) return null;

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-50 bg-background border-t border-border shadow-lg",
        "safe-area-inset-bottom",
        className
      )}
      style={{
        bottom: keyboardHeight,
        transition: 'bottom 0.1s ease-out',
      }}
    >
      <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto">
        <ToolbarButton onClick={toggleBold} isActive={state.isBold}>
          <Bold className="h-6 w-6" />
        </ToolbarButton>

        <ToolbarButton onClick={toggleItalic} isActive={state.isItalic}>
          <Italic className="h-6 w-6" />
        </ToolbarButton>

        <ToolbarButton onClick={toggleBulletList} isActive={state.isBulletList}>
          <List className="h-6 w-6" />
        </ToolbarButton>

        <ToolbarButton onClick={toggleOrderedList} isActive={state.isOrderedList}>
          <ListOrdered className="h-6 w-6" />
        </ToolbarButton>

        <ToolbarButton onClick={toggleHeading} isActive={state.isHeading1}>
          <Heading1 className="h-6 w-6" />
        </ToolbarButton>

        <ToolbarButton onClick={toggleCode} isActive={state.isCode}>
          <Code className="h-6 w-6" />
        </ToolbarButton>

        <ToolbarButton onClick={addLink} isActive={state.isLink}>
          <LinkIcon className="h-6 w-6" />
        </ToolbarButton>

        <EmojiPicker 
          editor={editor} 
          className="flex items-center justify-center w-11 h-11 min-w-[44px] rounded-lg transition-colors text-foreground hover:bg-muted active:bg-primary/20"
        />

        <ToolbarButton onClick={addImage}>
          <ImageIcon className="h-6 w-6" />
        </ToolbarButton>
      </div>
    </div>
  );
}
