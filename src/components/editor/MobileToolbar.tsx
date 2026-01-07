/**
 * Mobile Toolbar Component
 * 
 * Appears above the keyboard on touch devices.
 * Uses shared useToolbarState for optimized re-renders.
 * 
 * Features:
 * - Proper safe area inset handling for notched devices
 * - Larger touch targets (48px) for accessibility
 * - Comprehensive formatting options matching desktop
 */

import { useEffect, useState, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  ListTodo,
  Heading1,
  Heading2,
  Heading3,
  Code,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolbarState, safeEditorCommand } from './shared';
import { EmojiPicker } from './EmojiPicker';
import { undo, redo } from './plugins/collaboration';

interface MobileToolbarProps {
  editor: Editor;
  className?: string;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}

// Increased button size to 48px for better touch accessibility
function ToolbarButton({ onClick, isActive, disabled, children, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center justify-center w-12 h-12 min-w-[48px] rounded-lg transition-colors",
        "active:bg-primary/20 touch-manipulation",
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

// Divider component for visual separation
function ToolbarDivider() {
  return <div className="w-px h-8 bg-border mx-1 flex-shrink-0" />;
}

export default function MobileToolbar({ editor, className }: MobileToolbarProps) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [safeAreaBottom, setSafeAreaBottom] = useState(0);
  
  // Use shared toolbar state hook
  const state = useToolbarState(editor);

  // Get safe area insets
  useEffect(() => {
    const updateSafeArea = () => {
      // Get the safe area inset from CSS env() or compute from viewport
      const testEl = document.createElement('div');
      testEl.style.cssText = 'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom, 0px);';
      document.body.appendChild(testEl);
      const computedPadding = window.getComputedStyle(testEl).paddingBottom;
      document.body.removeChild(testEl);
      setSafeAreaBottom(parseFloat(computedPadding) || 0);
    };
    
    updateSafeArea();
    window.addEventListener('orientationchange', updateSafeArea);
    return () => window.removeEventListener('orientationchange', updateSafeArea);
  }, []);

  // Detect keyboard visibility using visualViewport API
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const windowHeight = window.innerHeight;
      const viewportHeight = viewport.height;
      const heightDiff = windowHeight - viewportHeight;
      
      // Keyboard is visible when there's a significant height difference
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
  const handleUndo = useCallback(() => {
    safeEditorCommand(editor, () => {
      undo(editor.state);
      editor.view.focus();
    });
  }, [editor]);

  const handleRedo = useCallback(() => {
    safeEditorCommand(editor, () => {
      redo(editor.state);
      editor.view.focus();
    });
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

  const toggleBulletList = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBulletList().run());
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleOrderedList().run());
  }, [editor]);

  const toggleTaskList = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleTaskList().run());
  }, [editor]);

  const toggleHeading1 = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 1 }).run());
  }, [editor]);

  const toggleHeading2 = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 2 }).run());
  }, [editor]);

  const toggleHeading3 = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleHeading({ level: 3 }).run());
  }, [editor]);

  const toggleCode = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleCode().run());
  }, [editor]);

  const toggleBlockquote = useCallback(() => {
    safeEditorCommand(editor, () => editor.chain().focus().toggleBlockquote().run());
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
        "fixed left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg",
        className
      )}
      style={{
        bottom: keyboardHeight,
        paddingBottom: safeAreaBottom > 0 ? `${safeAreaBottom}px` : 'env(safe-area-inset-bottom, 0px)',
        transition: 'bottom 0.1s ease-out',
      }}
    >
      {/* Scrollable toolbar container */}
      <div 
        className="flex items-center gap-0.5 px-2 py-2 overflow-x-auto scrollbar-hide"
        style={{
          paddingLeft: 'max(8px, env(safe-area-inset-left, 8px))',
          paddingRight: 'max(8px, env(safe-area-inset-right, 8px))',
        }}
      >
        {/* Undo/Redo */}
        <ToolbarButton onClick={handleUndo} title="Undo">
          <Undo className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleRedo} title="Redo">
          <Redo className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Text formatting */}
        <ToolbarButton onClick={toggleBold} isActive={state.isBold} title="Bold">
          <Bold className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleItalic} isActive={state.isItalic} title="Italic">
          <Italic className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleStrike} isActive={state.isStrike} title="Strikethrough">
          <Strikethrough className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleCode} isActive={state.isCode} title="Code">
          <Code className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Headings */}
        <ToolbarButton onClick={toggleHeading1} isActive={state.isHeading1} title="Heading 1">
          <Heading1 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleHeading2} isActive={state.isHeading2} title="Heading 2">
          <Heading2 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleHeading3} isActive={state.isHeading3} title="Heading 3">
          <Heading3 className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Lists */}
        <ToolbarButton onClick={toggleBulletList} isActive={state.isBulletList} title="Bullet List">
          <List className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleOrderedList} isActive={state.isOrderedList} title="Numbered List">
          <ListOrdered className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={toggleTaskList} isActive={state.isTaskList} title="Task List">
          <ListTodo className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Block elements */}
        <ToolbarButton onClick={toggleBlockquote} isActive={state.isBlockquote} title="Quote">
          <Quote className="h-5 w-5" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Insert */}
        <ToolbarButton onClick={addLink} isActive={state.isLink} title="Add Link">
          <LinkIcon className="h-5 w-5" />
        </ToolbarButton>
        <EmojiPicker 
          editor={editor} 
          className="flex items-center justify-center w-12 h-12 min-w-[48px] rounded-lg transition-colors text-foreground hover:bg-muted active:bg-primary/20 touch-manipulation"
        />
        <ToolbarButton onClick={addImage} title="Add Image">
          <ImageIcon className="h-5 w-5" />
        </ToolbarButton>
      </div>
    </div>
  );
}
