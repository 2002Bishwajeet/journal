import { useEffect, useState, useCallback, useRef } from "react";
import { HighlightedText } from "@/components/ui/HighlightedText";
import { Search, FileText, Loader2, Sparkles, Type, FileSearch, Wand2 } from "lucide-react";
import { advancedSearch, getAllDocuments } from "@/lib/db";
import { isIndexingInProgress } from "@/lib/workers";
import { cn } from "@/lib/utils";
import type { SearchIndexEntry, AdvancedSearchResult } from "@/types";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (docId: string) => void;
}

// Type for results - either basic search index entry or advanced result with highlights
type SearchResult = SearchIndexEntry | AdvancedSearchResult;

function isAdvancedResult(result: SearchResult): result is AdvancedSearchResult {
  return 'matchType' in result;
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

export default function SearchModal({
  isOpen,
  onClose,
  onSelectNote,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  const trimmedQuery = query.trim();
  const isLoading = Boolean(
    pendingQuery && pendingQuery === trimmedQuery && trimmedQuery
  );

  const handleClose = useCallback(() => {
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    setPendingQuery(null);
    onClose();
  }, [onClose]);

  // Check indexing status
  useEffect(() => {
    if (!isOpen) return;
    
    let cancelled = false;
    
    const checkIndexing = async () => {
      try {
        const indexing = await isIndexingInProgress();
        if (!cancelled) {
          setIsIndexing(indexing);
        }
      } catch {
        // Ignore errors during indexing check
      }
    };
    
    checkIndexing();
    const interval = setInterval(checkIndexing, 2000);
    
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  // Focus input when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    // Small timeout to ensure render is complete
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);

    // Load all notes initially
    (async () => {
      const docs = await getAllDocuments();
      if (cancelled) return;
      setResults(docs);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen]);

  // Search on query change
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    const requestSeq = ++requestSeqRef.current;
    let cancelled = false;

    if (!trimmed) {
      (async () => {
        const docs = await getAllDocuments();
        if (cancelled || requestSeqRef.current !== requestSeq) return;
        setResults(docs);
        setSelectedIndex(0);
      })();
      return () => {
        cancelled = true;
      };
    }

    const debounce = setTimeout(async () => {
      // Use advanced search with FTS, fuzzy matching, and highlighting
      const searchResults = await advancedSearch(trimmed);
      if (cancelled || requestSeqRef.current !== requestSeq) return;
      setPendingQuery((current) => (current === trimmed ? null : current));
      setResults(searchResults);
      setSelectedIndex(0);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [query, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (results.length === 0) return;
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          
          // Scroll active item into view
          const nextIndex = Math.min(selectedIndex + 1, results.length - 1);
          const nextEl = document.getElementById(`search-result-${nextIndex}`);
          nextEl?.scrollIntoView({ block: 'nearest' });
          break;
        case "ArrowUp":
          e.preventDefault();
          if (results.length === 0) return;
          setSelectedIndex((i) => Math.max(i - 1, 0));
          
          // Scroll active item into view
          const prevIndex = Math.max(selectedIndex - 1, 0);
          const prevEl = document.getElementById(`search-result-${prevIndex}`);
          prevEl?.scrollIntoView({ block: 'nearest' });
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            onSelectNote(results[selectedIndex].docId);
            handleClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          handleClose();
          break;
      }
    },
    [results, selectedIndex, onSelectNote, handleClose]
  );

  // Handle keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        // This is handled by parent component
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

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
            onChange={(e) => {
              const next = e.target.value;
              const nextTrimmed = next.trim();
              setPendingQuery(nextTrimmed ? nextTrimmed : null);
              setQuery(next);
              setSelectedIndex(0);
            }}
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
              {results.map((result, index) => {
                const isAdvanced = isAdvancedResult(result);
                const matchType = isAdvanced ? result.matchType : undefined;
                const contentHighlight = isAdvanced ? result.contentHighlight : undefined;
                const plainText = 'plainTextContent' in result ? result.plainTextContent : undefined;
                
                return (
                  <button
                    key={result.docId}
                    id={`search-result-${index}`}
                    onClick={() => {
                      onSelectNote(result.docId);
                      handleClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "flex items-start gap-3 w-full px-3 py-3 text-left rounded-md transition-colors",
                      index === selectedIndex ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <div className={cn(
                      "mt-0.5 p-1 rounded-md bg-background border border-border shadow-sm shrink-0",
                       index === selectedIndex ? "border-transparent" : "" 
                    )}>
                      <FileText className="h-4 w-4" />
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={cn(
                          "text-sm font-medium truncate",
                          index === selectedIndex ? "text-foreground" : "text-foreground"
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
                    
                    {index === selectedIndex && (
                      <div className="self-center shrink-0 text-muted-foreground opacity-50 px-2">
                        <span className="text-[10px]">↵</span>
                      </div>
                    )}
                  </button>
                );
              })}
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
