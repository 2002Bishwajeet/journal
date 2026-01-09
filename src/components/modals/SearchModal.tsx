import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HighlightedText } from "@/components/ui/HighlightedText";
import { Search, FileText, X, Loader2, Sparkles, Type, FileSearch, Wand2 } from "lucide-react";
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
    inputRef.current?.focus();

    // Load all notes initially
    (async () => {
      const docs = await getAllDocuments();
      if (cancelled) return;
      setResults(docs);
    })();

    return () => {
      cancelled = true;
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
          break;
        case "ArrowUp":
          e.preventDefault();
          if (results.length === 0) return;
          setSelectedIndex((i) => Math.max(i - 1, 0));
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
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="fixed inset-0 md:left-1/2 md:top-[20%] md:-translate-x-1/2 md:inset-auto md:w-full md:max-w-lg bg-popover border-b md:border border-border md:rounded-lg shadow-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
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
            className="border-0 focus-visible:ring-0 px-0 h-12 md:h-10 text-base md:text-sm"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Indexing indicator */}
        {isIndexing && trimmedQuery && (
          <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Indexing content... some results may be missing
            </span>
          </div>
        )}

        {/* Results */}
        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            <div className="py-2">
              {results.map((result, index) => {
                const isAdvanced = isAdvancedResult(result);
                const matchType = isAdvanced ? result.matchType : undefined;
                const contentHighlight = isAdvanced ? result.contentHighlight : undefined;
                const plainText = 'plainTextContent' in result ? result.plainTextContent : undefined;
                
                return (
                  <button
                    key={result.docId}
                    onClick={() => {
                      onSelectNote(result.docId);
                      handleClose();
                    }}
                    className={cn(
                      "flex items-start gap-3 w-full px-3 py-2 text-left",
                      "hover:bg-accent transition-colors",
                      index === selectedIndex && "bg-accent"
                    )}
                  >
                    <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">
                          {result.title || "Untitled"}
                        </p>
                        {matchType && (
                          <span 
                            className={cn(
                              "flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] shrink-0",
                              matchType === 'title' && "bg-blue-500/10 text-blue-500",
                              matchType === 'content' && "bg-green-500/10 text-green-500",
                              matchType === 'fuzzy' && "bg-orange-500/10 text-orange-500",
                              matchType === 'semantic' && "bg-purple-500/10 text-purple-500"
                            )}
                            title={getMatchTypeLabel(matchType)}
                          >
                            <MatchTypeIcon matchType={matchType} />
                          </span>
                        )}
                      </div>
                      {/* Show highlighted content if available, otherwise show first 80 chars */}
                      {contentHighlight ? (
                        <HighlightedText 
                          text={contentHighlight}
                          className="text-xs text-muted-foreground line-clamp-2 mt-0.5"
                        />
                      ) : plainText ? (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {plainText.slice(0, 80)}
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer hint - visible only on desktop */}
        <div className="hidden md:block px-3 py-2 border-t border-border bg-muted/50">
          <p className="text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">
              ↑↓
            </kbd>{" "}
            navigate
            <span className="mx-1.5">·</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">
              Enter
            </kbd>{" "}
            select
            <span className="mx-1.5">·</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">
              Esc
            </kbd>{" "}
            close
          </p>
        </div>
      </div>
    </div>
  );
}
