import { HighlightedText } from "@/components/ui/HighlightedText";
import { Search, FileText, Loader2, Sparkles, Type, FileSearch, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchModal, isAdvancedResult, type SearchResult } from "@/hooks/useSearchModal";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (docId: string) => void;
}

// Icon component for match type
function MatchTypeIcon({ matchType }: { matchType?: 'title' | 'content' | 'fuzzy' | 'semantic' }) {
  switch (matchType) {
    case 'title':
      return <Type className="h-3 w-3" />;
    case 'content':
      return <FileSearch className="h-3 w-3" />;
    case 'fuzzy':
      return <Wand2 className="h-3 w-3" />;
    case 'semantic':
      return <Sparkles className="h-3 w-3" />;
    default:
      return null;
  }
}

// Match type label for tooltip
function getMatchTypeLabel(matchType?: 'title' | 'content' | 'fuzzy' | 'semantic'): string {
  switch (matchType) {
    case 'title':
      return 'Title match';
    case 'content':
      return 'Content match';
    case 'fuzzy':
      return 'Fuzzy match';
    case 'semantic':
      return 'Semantic match';
    default:
      return '';
  }
}

// Result item component
function SearchResultItem({
  result,
  index,
  isSelected,
  onSelect,
  onHover,
}: {
  result: SearchResult;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const isAdvanced = isAdvancedResult(result);
  const matchType = isAdvanced ? result.matchType : undefined;
  const contentHighlight = isAdvanced ? result.contentHighlight : undefined;
  const plainText = 'plainTextContent' in result ? result.plainTextContent : undefined;

  return (
    <button
      key={result.docId}
      id={`search-result-${index}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        "flex items-start gap-3 w-full px-3 py-3 text-left rounded-md transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      <div className={cn(
        "mt-0.5 p-1 rounded-md bg-background border border-border shadow-sm shrink-0",
        isSelected ? "border-transparent" : ""
      )}>
        <FileText className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn(
            "text-sm font-medium truncate",
            isSelected ? "text-foreground" : "text-foreground"
          )}>
            {result.title || "Untitled"}
          </span>

          {matchType && (
            <span
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium shrink-0",
                matchType === 'title' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                matchType === 'content' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                matchType === 'fuzzy' && "bg-orange-500/10 text-orange-600 dark:text-orange-400",
                matchType === 'semantic' && "bg-purple-500/10 text-purple-600 dark:text-purple-400"
              )}
              title={getMatchTypeLabel(matchType)}
            >
              <MatchTypeIcon matchType={matchType} />
              {matchType}
            </span>
          )}
        </div>

        {/* Show highlighted content if available, otherwise show first 80 chars */}
        {contentHighlight ? (
          <HighlightedText
            text={contentHighlight}
            className="text-xs opacity-80 line-clamp-2"
          />
        ) : plainText ? (
          <p className="text-xs opacity-60 truncate">
            {plainText.slice(0, 100)}
          </p>
        ) : (
          <p className="text-xs opacity-40 italic">
            No preview available
          </p>
        )}
      </div>

      {isSelected && (
        <div className="self-center shrink-0 text-muted-foreground opacity-50 px-2">
          <span className="text-[10px]">↵</span>
        </div>
      )}
    </button>
  );
}

export default function SearchModal({
  isOpen,
  onClose,
  onSelectNote,
}: SearchModalProps) {
  const {
    query,
    results,
    selectedIndex,
    isLoading,
    isIndexing,
    trimmedQuery,
    inputRef,
    handleQueryChange,
    handleKeyDown,
    handleClose,
    handleSelectResult,
    setSelectedIndex,
  } = useSearchModal({ isOpen, onClose, onSelectNote });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-all duration-200"
      onClick={handleClose}
    >
      <div
        className="fixed left-1/2 top-[10%] -translate-x-1/2 w-full max-w-2xl bg-popover text-popover-foreground shadow-2xl border border-border sm:rounded-xl overflow-hidden flex flex-col max-h-[85vh] animation-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input - Large and clean */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border shrink-0">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes..."
            className="flex-1 bg-transparent border-0 outline-none text-lg placeholder:text-muted-foreground"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          <div className="hidden sm:flex items-center gap-1.5 ">
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <span className="text-xs">Esc</span>
            </kbd>
          </div>
        </div>

        {/* Indexing indicator */}
        {isIndexing && trimmedQuery && (
          <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2 shrink-0">
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Indexing in progress... results may be incomplete
            </span>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0 py-2">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin opacity-50" />
              <span>Searching...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {query ? 'No notes found matching your search.' : 'Start typing to search your notes.'}
            </div>
          ) : (
            <div className="px-2">
              <div className="text-xs font-semibold text-muted-foreground px-2 py-2 mb-1 uppercase tracking-wider">
                Notes
              </div>
              {results.map((result, index) => (
                <SearchResultItem
                  key={result.docId}
                  result={result}
                  index={index}
                  isSelected={index === selectedIndex}
                  onSelect={() => handleSelectResult(result.docId)}
                  onHover={() => setSelectedIndex(index)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer actions - visible only on desktop */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2 bg-muted/30 border-t border-border shrink-0 text-[11px] text-muted-foreground">
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <kbd className="bg-background border border-border px-1 rounded shadow-sm">↓</kbd>
              <kbd className="bg-background border border-border px-1 rounded shadow-sm">↑</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-background border border-border px-1 rounded shadow-sm">↵</kbd>
              select
            </span>
          </div>
          <div>
            <span className="opacity-70">
              {results.length} results
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
