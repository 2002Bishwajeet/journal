import { useState, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, X, ChevronRight } from "lucide-react";
import { useEditorContext } from "./EditorContext";
import { searchPluginKey } from "./plugins/SearchAndReplaceExtension";

export function FindReplaceBar() {
  const { editor } = useEditorContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchInfo, setMatchInfo] = useState({ total: 0, current: -1 });

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor) return;

    const handler = () => {
      const storage = editor.storage.searchAndReplace;
      if (!storage) return;

      setIsOpen(storage.isOpen);
      setIsReplaceOpen(storage.isReplaceOpen);

      const state = searchPluginKey.getState(editor.state);
      if (state) {
        setMatchInfo((prev) => {
          if (
            prev.total === state.results.length &&
            prev.current === state.currentIndex
          )
            return prev;
          return { total: state.results.length, current: state.currentIndex };
        });
      }
    };

    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!editor || !isOpen) return;
    editor.commands.updateSearch({ searchTerm, caseSensitive, wholeWord });
  }, [editor, searchTerm, caseSensitive, wholeWord, isOpen]);

  const handleClose = () => {
    setSearchTerm("");
    setReplaceTerm("");
    editor?.commands.closeSearch();
    editor?.commands.focus();
  };

  const handleNext = () => {
    editor?.commands.goToNextMatch();
  };

  const handlePrev = () => {
    editor?.commands.goToPrevMatch();
  };

  const handleReplace = () => {
    editor?.commands.replaceCurrentMatch(replaceTerm);
  };

  const handleReplaceAll = () => {
    editor?.commands.replaceAllMatches(replaceTerm);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) handlePrev();
      else handleNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleReplace();
    }
  };

  if (!editor) return null;

  const hasMatches = matchInfo.total > 0;
  const canReplace = hasMatches && editor.isEditable;

  return (
    <div
      className={`absolute top-0 left-2 right-2 sm:left-auto sm:right-3 z-20 mt-2 sm:mt-3 transition-[opacity,transform] duration-150 ${
        isOpen
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
      role="search"
      aria-label="Find and replace"
      aria-hidden={!isOpen}
      inert={!isOpen || undefined}
    >
      <div className="relative bg-background/95 backdrop-blur-sm border-b border-border rounded-lg p-2 sm:min-w-95 space-y-1.5">
        {/* Find row — Close button is excluded here; it lives last in DOM for tab order */}
        <div className="flex items-center gap-1">
          {/* Expand/collapse replace toggle */}
          <button
            onClick={() => setIsReplaceOpen(!isReplaceOpen)}
            aria-label={isReplaceOpen ? "Hide replace" : "Show replace"}
            aria-expanded={isReplaceOpen}
            className="h-7 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform duration-150 ${isReplaceOpen ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
          </button>

          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find…"
            aria-label="Find in note"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 h-7 px-2 text-sm bg-muted/50 border border-border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
          />

          {/* Match count */}
          <span
            className="text-xs text-muted-foreground tabular-nums min-w-14 text-center shrink-0 select-none"
            aria-live="polite"
          >
            {searchTerm
              ? hasMatches
                ? `${matchInfo.current + 1} of ${matchInfo.total}`
                : "No results"
              : ""}
          </span>

          <button
            onClick={handlePrev}
            disabled={!hasMatches}
            aria-label="Previous match (Shift+Enter)"
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            onClick={handleNext}
            disabled={!hasMatches}
            aria-label="Next match (Enter)"
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Case sensitive toggle */}
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            aria-label="Match case"
            aria-pressed={caseSensitive}
            className={`h-7 w-7 inline-flex items-center justify-center rounded text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0 transition-colors duration-100 ${
              caseSensitive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Aa
          </button>

          {/* Whole word toggle */}
          <button
            onClick={() => setWholeWord(!wholeWord)}
            aria-label="Match whole word"
            aria-pressed={wholeWord}
            className={`h-7 px-1 inline-flex items-center justify-center rounded text-xs font-bold tracking-tight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0 transition-colors duration-100 ${
              wholeWord
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span className="border-l border-current pl-px pr-px">ab</span>
          </button>

          {/* Reserve space where Close button used to sit so the find row width is unchanged */}
          <div className="w-7 shrink-0" aria-hidden="true" />
        </div>

        {/* Replace row — CSS grid expand trick */}
        <div
          className={`grid transition-[grid-template-rows] duration-[120ms] ${
            isReplaceOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden min-h-0" inert={!isReplaceOpen || undefined}>
            <div className="flex items-center gap-1 pt-0.5">
              {/* Spacer to align with find input */}
              <div className="w-5 shrink-0" />

              <input
                type="text"
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                onKeyDown={handleReplaceKeyDown}
                placeholder="Replace…"
                aria-label="Replace"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 min-w-0 h-7 px-2 text-sm bg-muted/50 border border-border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
              />

              <button
                onClick={handleReplace}
                disabled={!canReplace}
                aria-label="Replace current match"
                className="h-7 px-2 text-xs rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
              >
                Replace
              </button>

              <button
                onClick={handleReplaceAll}
                disabled={!canReplace}
                aria-label="Replace all matches"
                className="h-7 px-2 text-xs rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0 whitespace-nowrap"
              >
                Replace All
              </button>
            </div>
          </div>
        </div>

        {/* Close button — placed LAST in DOM so it is last in tab order,
            but visually anchored top-right via absolute positioning. */}
        <button
          onClick={handleClose}
          aria-label="Close find (Escape)"
          className="absolute top-2 right-2 h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
