import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronUp, ChevronDown, X, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEditorContext } from './EditorContext';
import { searchPluginKey } from './plugins/SearchAndReplaceExtension';

export function FindReplaceBar() {
    const { editor } = useEditorContext();
    const [isOpen, setIsOpen] = useState(false);
    const [isReplaceOpen, setIsReplaceOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [replaceTerm, setReplaceTerm] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [matchInfo, setMatchInfo] = useState({ total: 0, current: -1 });

    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editor) return;

        const handler = () => {
            const storage = editor.storage.searchAndReplace;
            if (!storage) return;

            if (storage.isOpen !== isOpen) setIsOpen(storage.isOpen);
            if (storage.isReplaceOpen !== isReplaceOpen) setIsReplaceOpen(storage.isReplaceOpen);

            const state = searchPluginKey.getState(editor.state);
            if (state) {
                setMatchInfo((prev) => {
                    if (prev.total === state.results.length && prev.current === state.currentIndex) return prev;
                    return { total: state.results.length, current: state.currentIndex };
                });
            }
        };

        editor.on('transaction', handler);
        return () => {
            editor.off('transaction', handler);
        };
    }, [editor, isOpen, isReplaceOpen]);

    useEffect(() => {
        if (isOpen) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            });
        } else {
            setSearchTerm('');
            setReplaceTerm('');
        }
    }, [isOpen]);

    useEffect(() => {
        if (!editor || !isOpen) return;
        editor.commands.updateSearch({ searchTerm, caseSensitive, wholeWord });
    }, [editor, searchTerm, caseSensitive, wholeWord, isOpen]);

    const handleClose = useCallback(() => {
        editor?.commands.closeSearch();
        editor?.commands.focus();
    }, [editor]);

    const handleNext = useCallback(() => {
        editor?.commands.goToNextMatch();
    }, [editor]);

    const handlePrev = useCallback(() => {
        editor?.commands.goToPrevMatch();
    }, [editor]);

    const handleReplace = useCallback(() => {
        editor?.commands.replaceCurrentMatch(replaceTerm);
    }, [editor, replaceTerm]);

    const handleReplaceAll = useCallback(() => {
        editor?.commands.replaceAllMatches(replaceTerm);
    }, [editor, replaceTerm]);

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) handlePrev();
            else handleNext();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
        }
    };

    const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            handleReplace();
        }
    };

    if (!editor) return null;

    const hasMatches = matchInfo.total > 0;
    const canReplace = hasMatches && editor.isEditable;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-0 left-2 right-2 sm:left-auto sm:right-3 z-20 mt-2 sm:mt-3"
                    role="search"
                    aria-label="Find and replace"
                >
                    <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-sm p-2 sm:min-w-[380px] space-y-1.5">
                        {/* Find row */}
                        <div className="flex items-center gap-1">
                            {/* Expand/collapse replace toggle */}
                            <button
                                onClick={() => setIsReplaceOpen(!isReplaceOpen)}
                                aria-label={isReplaceOpen ? 'Hide replace' : 'Show replace'}
                                aria-expanded={isReplaceOpen}
                                className="h-7 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
                            >
                                <ChevronRight
                                    className={`h-3.5 w-3.5 transition-transform duration-150 ${isReplaceOpen ? 'rotate-90' : ''}`}
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
                                className="text-xs text-muted-foreground tabular-nums min-w-[3.5rem] text-center shrink-0 select-none"
                                aria-live="polite"
                            >
                                {searchTerm
                                    ? hasMatches
                                        ? `${matchInfo.current + 1} of ${matchInfo.total}`
                                        : 'No results'
                                    : ''}
                            </span>

                            <button
                                onClick={handlePrev}
                                disabled={!hasMatches}
                                aria-label="Previous match (Shift+Enter)"
                                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
                            >
                                <ChevronUp className="h-4 w-4" aria-hidden="true" />
                            </button>

                            <button
                                onClick={handleNext}
                                disabled={!hasMatches}
                                aria-label="Next match (Enter)"
                                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
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
                                        ? 'bg-primary/15 text-foreground'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                            >
                                Aa
                            </button>

                            {/* Whole word toggle */}
                            <button
                                onClick={() => setWholeWord(!wholeWord)}
                                aria-label="Match whole word"
                                aria-pressed={wholeWord}
                                className={`h-7 px-1 inline-flex items-center justify-center rounded text-[10px] font-bold tracking-tight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0 transition-colors duration-100 ${
                                    wholeWord
                                        ? 'bg-primary/15 text-foreground'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                            >
                                <span className="border-l border-current pl-px pr-px">ab</span>
                            </button>

                            <button
                                onClick={handleClose}
                                aria-label="Close find (Escape)"
                                className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
                            >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>

                        {/* Replace row */}
                        <AnimatePresence>
                            {isReplaceOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.12 }}
                                    className="overflow-hidden"
                                >
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
                                            className="h-7 px-2 text-xs rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0"
                                        >
                                            Replace
                                        </button>

                                        <button
                                            onClick={handleReplaceAll}
                                            disabled={!canReplace}
                                            aria-label="Replace all matches"
                                            className="h-7 px-2 text-xs rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch-manipulation shrink-0 whitespace-nowrap"
                                        >
                                            All
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
