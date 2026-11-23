import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { HighlightedText } from "@/components/ui/HighlightedText";
import { Kbd } from "@/components/ui/kbd";
import { Search, FileText, Loader2, Sparkles, Type, Tag, FileSearch, Wand2, Clock, X, Folder, Pin, Calendar } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { COLLABORATIVE_FOLDER_ID } from "@/lib/homebase/config";
import type { AdvancedSearchResult, DocumentMetadata } from "@/types";
import { followKeyboard } from "@/lib/keyboardViewport";
import { proseOnly, CODE_SEPARATOR } from "@/lib/previewText";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { useSearchModal, isAdvancedResult, type SearchResult, type SearchEntry, type FilterEntry, type FilterButton } from "@/hooks/useSearchModal";

// Phones, and touch screens below the desktop breakpoint, get the full-screen search; a mouse keeps
// the palette from 640 px, where it always had it (#1289).
const SHEET_QUERY = "(max-width: 639px), (max-width: 1023px) and (pointer: coarse)";

function subscribeSheet(onChange: () => void) {
  const mql = window.matchMedia(SHEET_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

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
      return <Type className="h-3 w-3" aria-hidden="true" />;
    case 'tag':
      return <Tag className="h-3 w-3" aria-hidden="true" />;
    case 'content':
      return <FileSearch className="h-3 w-3" aria-hidden="true" />;
    case 'fuzzy':
      return <Wand2 className="h-3 w-3" aria-hidden="true" />;
    case 'semantic':
      return <Sparkles className="h-3 w-3" aria-hidden="true" />;
    default:
      return null;
  }
}

// Visible badge text: the meaning, not the engine's name for it
function getMatchTypeLabel(matchType?: AdvancedSearchResult['matchType']): string {
  switch (matchType) {
    case 'title':
      return 'Title';
    case 'tag':
      return 'Tag';
    case 'content':
      return 'Text';
    case 'fuzzy':
      return 'Similar';
    case 'semantic':
      return 'Related';
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
  const plainText = proseOnly('plainTextContent' in result ? result.plainTextContent : 'preview' in result ? result.preview ?? '' : '');
  const title = result.title || "Untitled";
  const markedTitle = markTitle(title, query, isAdvanced ? result.titleHighlight : undefined);
  const meta = metaLine(result.metadata, folderNames);

  return (
    <div
      key={result.docId}
      id={`search-result-${index}`}
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(); }}
      className={cn(
        "press-row flex items-start gap-3 w-full px-3 py-3 text-left rounded-md cursor-pointer select-none transition-colors duration-(--duration-fade)",
        removable && "pr-12",
        isSelected ? SELECTED_CUE : "text-muted-foreground hover:bg-muted/50"
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
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0",
                matchType === 'title' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                matchType === 'tag' && "bg-pink-500/10 text-pink-600 dark:text-pink-400",
                matchType === 'content' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                matchType === 'fuzzy' && "bg-orange-500/10 text-orange-600 dark:text-orange-400",
                matchType === 'semantic' && "bg-purple-500/10 text-purple-600 dark:text-purple-400"
              )}
            >
              <MatchTypeIcon matchType={matchType} />
              {getMatchTypeLabel(matchType)}
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
    </div>
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
    <div
      id={`search-result-${index}`}
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(); }}
      className={cn(
        "press-row flex items-center gap-3 w-full px-3 py-3 pr-12 text-left rounded-md cursor-pointer select-none transition-colors duration-(--duration-fade)",
        isSelected ? SELECTED_CUE : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium text-foreground truncate">{entry.text}</span>
    </div>
  );
}

// Selected row: the fill, plus a left bar and (in forced-colors mode, which drops both) an outline, so it is not colour alone.
const SELECTED_CUE =
  "bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--primary)] outline-2 -outline-offset-2 outline-transparent forced-colors:outline-[Highlight]";

const FILTER_ICONS = { tag: Tag, folder: Folder, is: Pin, before: Calendar, after: Calendar } as const;

/** A suggestion that completes the filter being typed (#1230). Keeps the input focused, like the Remove button. */
function FilterSuggestionRow({
  entry,
  index,
  isSelected,
  onSelect,
  onHover,
}: {
  entry: FilterEntry;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const Icon = FILTER_ICONS[entry.key];
  return (
    <div
      id={`search-result-${index}`}
      role="option"
      aria-selected={isSelected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(); }}
      className={cn(
        "press-row flex items-center gap-3 w-full px-3 py-2.5 pointer-coarse:min-h-11 text-left rounded-md cursor-pointer select-none transition-colors duration-(--duration-fade) touch-manipulation",
        isSelected ? SELECTED_CUE : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="text-sm font-medium text-foreground truncate flex-1">{entry.label}</span>
      {entry.count !== undefined && <span className="text-xs tabular-nums shrink-0">{entry.count}</span>}
    </div>
  );
}

const FILTER_BUTTONS: { button: FilterButton; label: string; icon: typeof Tag }[] = [
  { button: 'folder', label: 'Folder', icon: Folder },
  { button: 'tag', label: 'Tag', icon: Tag },
  { button: 'date', label: 'Date', icon: Calendar },
  { button: 'pinned', label: 'Pinned', icon: Pin },
];

const SECTION_TITLES = { recent: 'Recent', searches: 'Recent searches', notes: 'Notes', filters: 'Filters' } as const;

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

function RemoveButton({ label, ...props }: ReturnType<typeof keepInputFocus> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label} from recent`}
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
    searchText,
    chips,
    inputRef,
    handleQueryChange,
    handleCaretChange,
    handleRemoveChip,
    handleFilterButton,
    handleKeyDown,
    handleClose,
    setSelectedIndex,
    handleSelectEntry,
    handleRemoveEntry,
    handleClearRecents,
    status,
    handleDialogKeyDown,
  } = useSearchModal({ isOpen, onClose, onSelectNote, initialQuery });
  useOverlayHistory(isOpen, handleClose);
  const palette = !useSyncExternalStore(subscribeSheet, () => window.matchMedia(SHEET_QUERY).matches, () => false);

  if (!isOpen) return null;

  // Entries are in display order, so a section is a run of equal `section`s.
  const sections: { section: SearchEntry['section']; start: number; items: SearchEntry[] }[] = [];
  entries.forEach((entry, index) => {
    const last = sections[sections.length - 1];
    if (last?.section === entry.section) last.items.push(entry);
    else sections.push({ section: entry.section, start: index, items: [entry] });
  });

  // Portalled to body so the page behind can be made inert without disabling the dialog.
  return createPortal(
    <div
      data-search-root
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-all duration-200"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search notes"
        // On a phone the sheet fills what is left above the keyboard (followKeyboard sets the vars).
        ref={followKeyboard}
        className={cn(
          "fixed w-full bg-popover text-popover-foreground shadow-2xl border-border overflow-hidden flex flex-col animate-in fade-in duration-(--duration-fade) ease-(--ease-standard)",
          palette
            ? "left-1/2 top-[10%] -translate-x-1/2 max-w-2xl border rounded-xl max-h-[85dvh] zoom-in-95"
            : "inset-x-0 top-[var(--dialog-top,50%)] -translate-y-1/2 h-[var(--dialog-max-h,100dvh)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div role="status" aria-live="polite" className="sr-only">{status}</div>
        {/* Search input - Large and clean */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border shrink-0">
          {isLoading ? (
            <Loader2 className="h-5 w-5 text-muted-foreground shrink-0 animate-spin" aria-label="Searching" />
          ) : (
            <Search className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value, e.target.selectionStart ?? undefined)}
            onSelect={(e) => handleCaretChange(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-label="Search notes"
            aria-expanded={entries.length > 0}
            aria-controls="search-results"
            aria-autocomplete="list"
            aria-activedescendant={entries[selectedIndex] ? `search-result-${selectedIndex}` : undefined}
            enterKeyHint="search"
            placeholder="Search notes..."
            className="flex-1 bg-transparent border-0 outline-none text-lg placeholder:text-muted-foreground"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {palette ? (
            // A touch screen wide enough for the palette (an iPad in landscape) has no Esc key to show.
            <Kbd className="pointer-coarse:hidden">Esc</Kbd>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="h-11 px-2 -mr-2 text-sm font-medium text-primary shrink-0 touch-manipulation"
            >
              Cancel
            </button>
          )}
        </div>

        {/* The query's filters as chips (#1230), then on a phone the buttons that add one: one row, scrolled sideways. */}
        {(chips.length > 0 || !palette) && (
          <div className="flex items-center gap-1.5 px-3 py-1 pointer-coarse:py-0.5 border-b border-border shrink-0 overflow-x-auto overscroll-x-contain scrollbar-hide">
            {chips.map((chip) => (
              <button
                key={`${chip.token.start}:${chip.label}`}
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                {...keepInputFocus(() => handleRemoveChip(chip))}
                className="group flex items-center h-8 pointer-coarse:h-11 shrink-0 touch-manipulation"
              >
                <span className="flex items-center gap-1 h-7 pointer-coarse:h-8 pl-2.5 pr-1.5 rounded-full bg-accent text-accent-foreground text-xs font-medium whitespace-nowrap">
                  {chip.label}
                  <X className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100" />
                </span>
              </button>
            ))}
            {!palette && FILTER_BUTTONS.map(({ button, label, icon: Icon }) => (
              <button
                key={button}
                type="button"
                aria-pressed={button === 'pinned' ? chips.some((c) => c.token.kind === 'is' && c.token.value === 'pinned') : undefined}
                {...keepInputFocus(() => handleFilterButton(button))}
                className="group flex items-center h-11 shrink-0 touch-manipulation"
              >
                <span className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-border text-xs font-medium text-muted-foreground whitespace-nowrap group-aria-pressed:bg-accent group-aria-pressed:text-accent-foreground group-aria-pressed:border-transparent">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 py-2">
          {entries.length === 0 ? (
            // While a query is pending, an empty list is not yet an answer.
            isLoading ? null : (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query ? 'No notes found matching your search.' : 'Search titles and text. Narrow with tag:, folder:, is:pinned, before:, after:'}
              </div>
            )
          ) : (
            <div id="search-results" role="listbox" aria-label="Results" className="px-2">
              {sections.map(({ section, start, items }) => (
                <div key={section} role="group" aria-labelledby={`search-section-${section}`}>
                  <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-2 py-2 mb-1 uppercase tracking-wider">
                    <span id={`search-section-${section}`}>{SECTION_TITLES[section]}</span>
                    {start === 0 && (section === 'recent' || section === 'searches') && (
                      <button
                        type="button"
                        {...keepInputFocus(handleClearRecents)}
                        className="normal-case tracking-normal font-medium px-1 pointer-coarse:h-11 pointer-coarse:-my-3.5 pointer-coarse:px-3 pointer-coarse:-mr-2 hover:text-foreground touch-manipulation"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {items.map((entry, i) => {
                    const index = start + i;
                    const key = entry.kind === 'search' ? `search:${entry.text}`
                      : entry.kind === 'filter' ? `filter:${entry.token}`
                      : `${entry.section}:${entry.result.docId}`;
                    return (
                      <div key={key} className="relative">
                        {entry.kind === 'filter' ? (
                          <FilterSuggestionRow
                            entry={entry}
                            index={index}
                            isSelected={index === selectedIndex}
                            onSelect={() => handleSelectEntry(entry)}
                            onHover={() => setSelectedIndex(index)}
                          />
                        ) : entry.kind === 'note' ? (
                          <SearchResultItem
                            result={entry.result}
                            index={index}
                            query={searchText}
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
                        {entry.kind !== 'filter' && entry.section !== 'notes' && (
                          <RemoveButton
                            label={entry.kind === 'search' ? entry.text : entry.result.title || 'Untitled'}
                            {...keepInputFocus(() => handleRemoveEntry(entry))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions - the palette only */}
        {palette && (
          <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-t border-border shrink-0 text-[11px] text-muted-foreground">
            <div className="flex gap-4 pointer-coarse:invisible">
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
        )}
      </div>
    </div>,
    document.body,
  );
}
