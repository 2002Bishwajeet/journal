import { HighlightedText } from "@/components/ui/HighlightedText";
import { Kbd } from "@/components/ui/kbd";
import { Search, FileText, Loader2, Sparkles, Type, Tag, FileSearch, Wand2, Clock, X } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { COLLABORATIVE_FOLDER_ID } from "@/lib/homebase/config";
import type { AdvancedSearchResult, DocumentMetadata } from "@/types";
import { followKeyboard } from "@/lib/keyboardViewport";
import { proseOnly, CODE_SEPARATOR } from "@/lib/previewText";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { useSearchModal, isAdvancedResult, type SearchResult, type SearchEntry } from "@/hooks/useSearchModal";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (docId: string, find?: string) => void;
  /** The query the search opens with (journal://search?q=). */
  initialQuery?: string;
}

// Icon component for match type
function MatchTypeIcon({ matchType }: { matchType?: AdvancedSearchResult['matchType'] }) {
  switch (matchType) {
    case 'title':
      return <Type className="h-3 w-3" />;
    case 'tag':
      return <Tag className="h-3 w-3" />;
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
function getMatchTypeLabel(matchType?: AdvancedSearchResult['matchType']): string {
  switch (matchType) {
    case 'title':
      return 'Title match';
    case 'tag':
      return 'Tag match';
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

/** The title with the query's text marked: the ts_headline fragment when it has one, else a case-insensitive substring. */
function markTitle(title: string, query: string, titleHighlight?: string): string | null {
  if (titleHighlight?.includes('<mark>')) return titleHighlight;
  const q = query.trim();
  const at = q ? title.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return at === -1 ? null : `${title.slice(0, at)}<mark>${title.slice(at, at + q.length)}</mark>${title.slice(at + q.length)}`;
}

/** Folder · relative date · up to 3 tags, for telling same-titled notes apart. */
function metaLine(metadata: DocumentMetadata, folderNames: Map<string, string>): string {
  const folder = metadata.folderId === COLLABORATIVE_FOLDER_ID ? 'Shared' : folderNames.get(metadata.folderId);
  const modified = metadata.timestamps?.modified;
  return [
    folder,
    modified ? formatRelativeTime(modified) : null,
    (metadata.tags ?? []).slice(0, 3).map((t) => `#${t}`).join(' '),
  ].filter(Boolean).join(' · ');
}

// Result item component
function SearchResultItem({
  result,
  index,
  query,
  folderNames,
  isSelected,
  onSelect,
  onHover,
  removable,
}: {
  result: SearchResult;
  index: number;
  query: string;
  folderNames: Map<string, string>;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
  /** Leaves room on the right for the remove button. */
  removable?: boolean;
}) {
  const isAdvanced = isAdvancedResult(result);
  const matchType = isAdvanced ? result.matchType : undefined;
  const contentHighlight = isAdvanced ? result.contentHighlight?.replaceAll(CODE_SEPARATOR, ' ') : undefined;
  const plainText = proseOnly('plainTextContent' in result ? result.plainTextContent : 'preview' in result ? result.preview : '');
  const title = result.title || "Untitled";
  const markedTitle = markTitle(title, query, isAdvanced ? result.titleHighlight : undefined);
  const meta = metaLine(result.metadata, folderNames);

  return (
    <button
      key={result.docId}
      id={`search-result-${index}`}
      onClick={onSelect}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(); }}
      className={cn(
        "press-row flex items-start gap-3 w-full px-3 py-3 text-left rounded-md transition-colors duration-(--duration-fade)",
        removable && "pr-12",
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
            "text-sm font-medium truncate pointer-coarse:text-[15px]",
            isSelected ? "text-foreground" : "text-foreground"
          )}>
            {markedTitle ? <HighlightedText text={markedTitle} /> : title}
          </span>

          {matchType && (
            <span
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium shrink-0",
                matchType === 'title' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                matchType === 'tag' && "bg-pink-500/10 text-pink-600 dark:text-pink-400",
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

        {meta && <p className="text-xs opacity-70 truncate mb-0.5">{meta}</p>}

        {/* Show highlighted content if available, otherwise the first 100 chars; nothing for an empty note */}
        {contentHighlight ? (
          <HighlightedText
            text={contentHighlight}
            className="text-xs opacity-80 line-clamp-2"
          />
        ) : plainText ? (
          <p className="text-xs opacity-60 pointer-coarse:opacity-100 pointer-coarse:text-[13px] truncate">
            {plainText.slice(0, 100)}
          </p>
        ) : null}
      </div>

      {isSelected && (
        <div className="self-center shrink-0 text-muted-foreground opacity-50 px-2">
          <span className="text-[10px] pointer-coarse:hidden">↵</span>
        </div>
      )}
    </button>
  );
}

function RecentSearchRow({
  entry,
  index,
  isSelected,
  onSelect,
  onHover,
}: {
  entry: Extract<SearchEntry, { kind: 'search' }>;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      id={`search-result-${index}`}
      onClick={onSelect}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(); }}
      className={cn(
        "press-row flex items-center gap-3 w-full px-3 py-3 pr-12 text-left rounded-md transition-colors duration-(--duration-fade)",
        isSelected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium text-foreground truncate">{entry.text}</span>
    </button>
  );
}

const SECTION_TITLES = { recent: 'Recent', searches: 'Recent searches', notes: 'Notes' } as const;

/**
 * Props for the Remove and Clear buttons. They act without taking focus from the search input,
 * so the arrow keys keep working. A keyboard press hands focus back, since the button then unmounts.
 */
function keepInputFocus(action: () => void) {
  return {
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => {
      const input = document.activeElement === e.currentTarget
        ? e.currentTarget.closest('[role="dialog"]')?.querySelector('input')
        : null;
      action();
      input?.focus();
    },
  };
}

function RemoveButton(props: ReturnType<typeof keepInputFocus>) {
  return (
    <button
      type="button"
      aria-label="Remove from recent"
      {...props}
      className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 pointer-coarse:size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground touch-manipulation"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

export default function SearchModal({
  isOpen,
  onClose,
  onSelectNote,
  initialQuery,
}: SearchModalProps) {
  const {
    query,
    entries,
    selectedIndex,
    isLoading,
    folderNames,
    inputRef,
    handleQueryChange,
    handleKeyDown,
    handleClose,
    setSelectedIndex,
    handleSelectEntry,
    handleRemoveEntry,
    handleClearRecents,
  } = useSearchModal({ isOpen, onClose, onSelectNote, initialQuery });
  useOverlayHistory(isOpen, handleClose);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-all duration-200"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search notes"
        // On a phone the sheet fills what is left above the keyboard (followKeyboard sets the vars).
        ref={followKeyboard}
        className="fixed inset-x-0 top-[var(--dialog-top,50%)] -translate-y-1/2 h-[var(--dialog-max-h,100dvh)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:left-1/2 sm:top-[10%] sm:-translate-x-1/2 sm:translate-y-0 sm:h-auto sm:pt-0 sm:pb-0 w-full max-w-2xl bg-popover text-popover-foreground shadow-2xl sm:border border-border sm:rounded-xl overflow-hidden flex flex-col sm:max-h-[85dvh] animate-in fade-in sm:zoom-in-95 duration-(--duration-fade) ease-(--ease-standard)"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input - Large and clean */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border shrink-0">
          {isLoading ? (
            <Loader2 className="h-5 w-5 text-muted-foreground shrink-0 animate-spin" aria-label="Searching" />
          ) : (
            <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
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
            <Kbd>Esc</Kbd>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="sm:hidden h-11 px-2 -mr-2 text-sm font-medium text-primary shrink-0 touch-manipulation"
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 py-2">
          {entries.length === 0 ? (
            // While a query is pending, an empty list is not yet an answer.
            isLoading ? null : (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query ? 'No notes found matching your search.' : 'Start typing to search your notes.'}
              </div>
            )
          ) : (
            <div className="px-2">
              {entries.map((entry, index) => {
                const showHeader = entries[index - 1]?.section !== entry.section;
                return (
                  <div key={entry.kind === 'search' ? `search:${entry.text}` : `${entry.section}:${entry.result.docId}`}>
                    {showHeader && (
                      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-2 py-2 mb-1 uppercase tracking-wider">
                        <span>{SECTION_TITLES[entry.section]}</span>
                        {index === 0 && entry.section !== 'notes' && (
                          <button
                            type="button"
                            {...keepInputFocus(handleClearRecents)}
                            className="normal-case tracking-normal font-medium px-1 pointer-coarse:h-11 pointer-coarse:-my-3.5 pointer-coarse:px-3 pointer-coarse:-mr-2 hover:text-foreground touch-manipulation"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                    <div className="relative">
                      {entry.kind === 'note' ? (
                        <SearchResultItem
                          result={entry.result}
                          index={index}
                          query={query}
                          folderNames={folderNames}
                          isSelected={index === selectedIndex}
                          onSelect={() => handleSelectEntry(entry)}
                          onHover={() => setSelectedIndex(index)}
                          removable={entry.section === 'recent'}
                        />
                      ) : (
                        <RecentSearchRow
                          entry={entry}
                          index={index}
                          isSelected={index === selectedIndex}
                          onSelect={() => handleSelectEntry(entry)}
                          onHover={() => setSelectedIndex(index)}
                        />
                      )}
                      {entry.section !== 'notes' && <RemoveButton {...keepInputFocus(() => handleRemoveEntry(entry))} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer actions - visible only on desktop */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2 bg-muted/30 border-t border-border shrink-0 text-[11px] text-muted-foreground">
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <Kbd>↓</Kbd>
              <Kbd>↑</Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              select
            </span>
          </div>
          <div>
            <span className="opacity-70">
              {entries.filter((e) => e.kind === 'note').length} results
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
