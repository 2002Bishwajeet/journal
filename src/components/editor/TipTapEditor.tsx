/**
 * TipTap Editor Component
 *
 * Main rich text editor with Y.js collaboration support.
 * Uses modular plugin system and performance optimizations.
 * Refactored to consume EditorContext.
 */

import { useState, useRef, useEffect } from "react";
import { EditorContent } from "@tiptap/react";
import type { DocumentMetadata } from "@/types";
import { debounce } from "@/lib/utils/index";
import { useEditorContext } from "./EditorContext";
import { useDeviceType } from "@/hooks";

import EditorToolbar from "./EditorToolbar";
import MobileToolbar from "./MobileToolbar";
import BubbleMenuToolbar from "./BubbleMenuToolbar";
import { AISuggestionOverlay } from "./AISuggestionOverlay";
import { TableColumnMenu } from "./table/TableColumnMenu";
import { TableRowMenu } from "./table/TableRowMenu";
import { TagInput } from "./TagInput";

// Import KaTeX styles for math rendering
import "katex/dist/katex.min.css";

interface TipTapEditorProps {
  noteId: string;
  metadata: DocumentMetadata;
  onMetadataChange?: (metadata: DocumentMetadata) => void;
  hideToolbar?: boolean;
  className?: string;
}

export default function TipTapEditor({
  noteId,
  metadata,
  onMetadataChange,
  hideToolbar = false,
  className = "",
}: TipTapEditorProps) {
  const { editor, isLoading } = useEditorContext();
  const deviceType = useDeviceType();
  const [title, setTitle] = useState(metadata.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [wordCount, setWordCount] = useState({ words: 0, characters: 0 });
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text = editor.getText();
      setWordCount({ words: text.split(/\s+/).filter(Boolean).length, characters: text.length });
    };
    update();
    const debounced = debounce(update, 500);
    editor.on("update", debounced);
    return () => { editor.off("update", debounced); };
  }, [editor]);

  // Debounce metadata updates to prevent excessive sync calls
  const debouncedMetadataUpdate = useRef(
    debounce((newTitle: string) => {
      onMetadataChange?.({
        ...metadata,
        title: newTitle,
        timestamps: {
          ...metadata.timestamps,
          modified: new Date().toISOString(),
        },
      });
    }, 500)
  ).current;

  // Handle title changes
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    debouncedMetadataUpdate(newTitle);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400">Loading document...</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Title input */}
      <div className="px-4 pt-4 pb-2">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="w-full text-3xl font-bold bg-transparent border-none outline-none placeholder:text-gray-400 dark:text-white"
        />
      </div>

      {/* Tag Input */}
      <TagInput docId={noteId} metadata={metadata} />

      {/* Toolbar */}
      {editor && !hideToolbar && <EditorToolbar editor={editor} />}

      {/* Editor content */}
      <div>
        <EditorContent editor={editor} />
      </div>

      {/* Mobile Toolbar - appears above keyboard on touch devices */}
      {editor && <MobileToolbar editor={editor} />}
      
      {/* Bubble Menu - appears when text is selected on any screen */}
      {editor && <BubbleMenuToolbar editor={editor} />}
      
      {/* Table Handles */}
      {editor && <TableColumnMenu editor={editor} />}
      {editor && <TableRowMenu editor={editor} />}

      {/* AI Suggestion Overlay - shows inline suggestions from slash commands */}
      {editor && deviceType !== 'mobile' && <AISuggestionOverlay editor={editor} />}

      {/* Word Count Status Bar */}
      {editor && (
        <div className="flex items-center justify-end px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-muted-foreground select-none">
          <span>{wordCount.words} words</span>
          <span className="mx-2">·</span>
          <span>{wordCount.characters} characters</span>
        </div>
      )}
    </div>
  );
}
