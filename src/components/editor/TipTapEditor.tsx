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
import { debounce } from "@/lib/utils";
import { readingTimeMinutes } from "@/lib/editor/extractHeadings";
import { takeNewNote } from "@/lib/newNoteFocus";
import { useEditorContext } from "./EditorContext";

import EditorToolbar from "./EditorToolbar";
import MobileToolbar from "./MobileToolbar";
import BubbleMenuToolbar from "./BubbleMenuToolbar";
import { TableColumnMenu } from "./table/TableColumnMenu";
import { TableRowMenu } from "./table/TableRowMenu";
import { TagInput } from "./TagInput";
import { NoteCover } from "./NoteCover";

interface TipTapEditorProps {
  noteId: string;
  metadata: DocumentMetadata;
  onMetadataChange?: (metadata: DocumentMetadata) => void;
  hideToolbar?: boolean;
  className?: string;
  /** Touch layouts: a note that "New" just created opens with its title focused and selected (#825). */
  focusNewTitle?: boolean;
  /** Touch layouts: the header shows the small title while this one is scrolled out of view (#825). */
  onTitleInView?: (inView: boolean) => void;
}

export default function TipTapEditor({
  noteId,
  metadata,
  onMetadataChange,
  hideToolbar = false,
  className = "",
  focusNewTitle = false,
  onTitleInView,
}: TipTapEditorProps) {
  const { editor, isLoading, readOnly } = useEditorContext();
  const [title, setTitle] = useState(metadata.title);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  // The field exists once the note has loaded.
  useEffect(() => {
    const field = titleInputRef.current;
    if (!field || !focusNewTitle || !takeNewNote(noteId)) return;
    field.focus();
    field.select();
  }, [isLoading, focusNewTitle, noteId]);

  useEffect(() => {
    const field = titleInputRef.current;
    if (!field || !onTitleInView) return;
    const observer = new IntersectionObserver(([entry]) => onTitleInView(entry.isIntersecting));
    observer.observe(field);
    return () => observer.disconnect();
  }, [isLoading, onTitleInView]);
  // Re-sync the field when the title changes elsewhere (MCP, another tab),
  // unless the user is typing in it.
  const [titleFocused, setTitleFocused] = useState(false);
  const [prevMetadataTitle, setPrevMetadataTitle] = useState(metadata.title);
  if (metadata.title !== prevMetadataTitle) {
    setPrevMetadataTitle(metadata.title);
    if (!titleFocused) setTitle(metadata.title);
  }

  const [wordCount, setWordCount] = useState({ words: 0, characters: 0 });
  const wordCountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text = editor.getText();
      setWordCount({ words: text.split(/\s+/).filter(Boolean).length, characters: text.length });
    };
    const handleUpdate = () => {
      if (wordCountTimeoutRef.current) clearTimeout(wordCountTimeoutRef.current);
      wordCountTimeoutRef.current = setTimeout(() => {
        update();
        wordCountTimeoutRef.current = null;
      }, 500);
    };
    update();
    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
      if (wordCountTimeoutRef.current) {
        clearTimeout(wordCountTimeoutRef.current);
        wordCountTimeoutRef.current = null;
      }
    };
  }, [editor]);

  // Debounce metadata updates to prevent excessive sync calls. It is created
  // once, so it debounces a thunk rather than a title: the payload is built in
  // the keystroke handler, from that render's `metadata`. Closing over `metadata`
  // here instead would freeze the first render's snapshot forever, and any flag
  // set afterwards (e.g. isPublic, from ShareDialog) would be written back as
  // missing — the bug this fixes.
  // ponytail: a flip landing inside the 500ms window after the last keystroke
  // still writes the pre-flip snapshot. Read it from a store if that matters.
  const debouncedMetadataUpdate = useRef(
    debounce((run: () => void) => run(), 500)
  ).current;

  // Handle title changes
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    debouncedMetadataUpdate(() =>
      onMetadataChange?.({
        ...metadata,
        title: newTitle,
        timestamps: {
          ...metadata.timestamps,
          modified: new Date().toISOString(),
        },
      })
    );
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
      {/* Header: "Add cover" shows on hover anywhere in it */}
      <div className="group/header">
        <NoteCover metadata={metadata} />

        {/* Title input */}
        <div className="px-4 pt-4 pb-2">
          {/* Wraps up to three lines, then scrolls. A title is one line: Enter and pasted newlines don't break it.
              ponytail: field-sizing grows it; a browser without it shows one scrolling row, add JS autosize if that matters. */}
          <textarea
            ref={titleInputRef}
            rows={1}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value.replace(/\s*\n\s*/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            readOnly={readOnly}
            placeholder="Untitled"
            aria-label="Note title"
            className="block w-full max-h-[3lh] resize-none overflow-y-auto [field-sizing:content] text-3xl font-bold bg-transparent border-none outline-none placeholder:text-gray-400 dark:text-white"
          />
        </div>
      </div>

      {/* Tag Input */}
      {!readOnly && <TagInput docId={noteId} metadata={metadata} />}

      {/* Toolbar */}
      {editor && !hideToolbar && !readOnly && <EditorToolbar editor={editor} />}

      {/* Editor content */}
      <div>
        <EditorContent editor={editor} />
      </div>

      {/* A view-only note gets none of the editing toolbars (#897) */}
      {editor && !readOnly && (
        <>
          {/* Mobile Toolbar - appears above keyboard on touch devices */}
          <MobileToolbar editor={editor} />
          {/* Bubble Menu - appears when text is selected on any screen */}
          <BubbleMenuToolbar editor={editor} />
          {/* Table Handles */}
          <TableColumnMenu editor={editor} />
          <TableRowMenu editor={editor} />
        </>
      )}

      {/* Word Count Status Bar */}
      {editor && (
        <div className="flex items-center justify-end px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-muted-foreground select-none">
          <span>{wordCount.words} words</span>
          <span className="mx-2">·</span>
          <span>{wordCount.characters} characters</span>
          {wordCount.words > 0 && (
            <>
              <span className="mx-2">·</span>
              <span>{readingTimeMinutes(wordCount.words)} min read</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
