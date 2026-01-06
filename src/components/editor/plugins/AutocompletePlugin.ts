/**
 * Autocomplete Plugin for TipTap
 * 
 * Shows grey ghost text suggestions ahead of the cursor.
 * 
 * Activation conditions (ALL must be true):
 * - AI is enabled and ready
 * - User has been actively typing (not just viewing/selecting)
 * - Cursor is at end of content (not in middle of text)
 * - No text is selected
 * - User stopped typing for 2+ seconds
 * - Recent edits were insertions (not deletions or formatting)
 * 
 * Controls:
 * - Tab: Accept suggestion
 * - Escape: Dismiss suggestion
 * - Any typing: Dismiss and restart timer
 * - Moving cursor: Dismiss suggestion
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface AutocompletePluginOptions {
    getSuggestion: (text: string) => Promise<string>;
    isAIReadyRef: { current: boolean }; // React ref object
    debounceMs?: number;
    minCharsBeforeTrigger?: number;
    debug?: boolean;
}

interface AutocompleteState {
    suggestion: string | null;
    position: number | null;
    isLoading: boolean;
}

const autocompletePluginKey = new PluginKey<AutocompleteState>('autocomplete');

/**
 * Checks if we're likely seeing text typing by comparing two editor states.
 * Simplified logic:
 * 1. Document size increased by 1-10 characters (typical typing)
 * 2. Cursor moved forward (typing inserts at cursor)
 */
function isTextInsertion(
    currentState: { doc: { content: { size: number } }; selection: { from: number } },
    prevState: { doc: { content: { size: number } }; selection: { from: number } }
): boolean {
    const prevSize = prevState.doc.content.size;
    const newSize = currentState.doc.content.size;
    const sizeDiff = newSize - prevSize;

    // Typing usually adds 1-10 characters at a time
    // Deletions (sizeDiff <= 0) or large pastes (sizeDiff > 10) don't trigger autocomplete
    if (sizeDiff <= 0 || sizeDiff > 10) {
        return false;
    }

    // Cursor should have moved forward (typing inserts at cursor)
    const prevFrom = prevState.selection.from;
    const newFrom = currentState.selection.from;

    return newFrom > prevFrom;
}

/**
 * Checks if cursor is at a reasonable position for autocomplete.
 * More permissive: only reject if clearly in the middle of a word with more text after.
 */
function isCursorAtGoodPosition(state: { selection: { from: number; to: number; empty: boolean }; doc: { textBetween: (from: number, to: number, sep?: string) => string; content: { size: number } } }): boolean {
    const { from, to, empty } = state.selection;

    // Must have no selection (cursor only)
    if (!empty || from !== to) return false;

    // Get a few characters after cursor
    const maxEnd = Math.min(from + 10, state.doc.content.size - 1);
    const textAfter = maxEnd > from ? state.doc.textBetween(from, maxEnd, '') : '';

    // Only reject if there's substantial text after that looks like a word
    // Allow: whitespace, punctuation, or nothing after cursor
    if (textAfter.length > 0) {
        const firstChar = textAfter[0];
        // If the first character after cursor is a letter/number, we're mid-word - skip
        if (/[a-zA-Z0-9]/.test(firstChar)) {
            return false;
        }
    }

    return true;
}

export const AutocompletePlugin = Extension.create<AutocompletePluginOptions>({
    name: 'autocomplete',

    addOptions() {
        return {
            getSuggestion: async () => '',
            isAIReadyRef: { current: false }, // Default ref-like object
            debounceMs: 2000, // 2 seconds after stopping
            minCharsBeforeTrigger: 20, // Need at least 20 chars of context
            debug: false,
        };
    },

    addKeyboardShortcuts() {
        return {
            // Tab to accept suggestion
            Tab: ({ editor }) => {
                const state = autocompletePluginKey.getState(editor.state);
                if (state?.suggestion && state.position !== null) {
                    // Insert the suggestion at the current position
                    editor.commands.insertContent(state.suggestion);
                    return true;
                }
                return false;
            },
            // Escape to dismiss
            Escape: ({ editor }) => {
                const state = autocompletePluginKey.getState(editor.state);
                if (state?.suggestion) {
                    const tr = editor.state.tr.setMeta(autocompletePluginKey, { clear: true });
                    editor.view.dispatch(tr);
                    return true;
                }
                return false;
            },
        };
    },

    addProseMirrorPlugins() {
        const options = this.options;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let currentRequest: AbortController | null = null;
        let lastTypingTimestamp = 0;
        let consecutiveTypingCount = 0;

        const clearState = () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }
            if (currentRequest) {
                currentRequest.abort();
                currentRequest = null;
            }
        };

        const log = (message: string, ...args: any[]) => {
            if (options.debug) {
                console.log(`[Autocomplete] ${message}`, ...args);
            }
        };

        return [
            new Plugin<AutocompleteState>({
                key: autocompletePluginKey,

                state: {
                    init(): AutocompleteState {
                        return { suggestion: null, position: null, isLoading: false };
                    },

                    apply(tr, value): AutocompleteState {
                        const meta = tr.getMeta(autocompletePluginKey);

                        // Explicit clear
                        if (meta?.clear) {
                            return { suggestion: null, position: null, isLoading: false };
                        }

                        // New suggestion
                        if (meta?.suggestion !== undefined) {
                            return {
                                suggestion: meta.suggestion,
                                position: meta.position,
                                isLoading: false,
                            };
                        }

                        // Loading state
                        if (meta?.loading) {
                            return { ...value, isLoading: true };
                        }

                        // Clear on document change (user typed something)
                        if (tr.docChanged) {
                            return { suggestion: null, position: null, isLoading: false };
                        }

                        // Clear on selection change (user moved cursor)
                        if (tr.selectionSet && value.suggestion) {
                            return { suggestion: null, position: null, isLoading: false };
                        }

                        return value;
                    },
                },

                props: {
                    decorations(state) {
                        const pluginState = this.getState(state);
                        if (!pluginState?.suggestion || pluginState.position === null) {
                            return DecorationSet.empty;
                        }

                        // Verify position is still valid and cursor is there
                        const { from, empty } = state.selection;
                        if (!empty || from !== pluginState.position) {
                            return DecorationSet.empty;
                        }

                        // Create widget decoration for ghost text
                        const widget = Decoration.widget(
                            pluginState.position,
                            () => {
                                const span = document.createElement('span');
                                span.className = 'autocomplete-suggestion';
                                span.textContent = pluginState.suggestion;
                                span.setAttribute('data-autocomplete', 'true');
                                span.setAttribute('contenteditable', 'false');
                                return span;
                            },
                            { side: 1 } // Place after cursor position
                        );

                        return DecorationSet.create(state.doc, [widget]);
                    },
                },

                view(view) {
                    const fetchSuggestion = async () => {
                        // Check if AI is ready
                        if (!options.isAIReadyRef.current) {
                            log('Skipping: AI not ready');
                            return;
                        }

                        // Check if cursor is at a good position
                        if (!isCursorAtGoodPosition(view.state)) {
                            log('Skipping: Bad cursor position');
                            return;
                        }

                        // Get text before cursor
                        const { from } = view.state.selection;
                        const textBefore = view.state.doc.textBetween(
                            Math.max(0, from - 200),
                            from,
                            ' '
                        );

                        // Need minimum context
                        if (textBefore.trim().length < options.minCharsBeforeTrigger!) {
                            log(`Skipping: Text too short (${textBefore.trim().length} chars)`);
                            return;
                        }

                        // Text should end with a partial sentence/word
                        // Don't trigger if text ends with lots of whitespace
                        if (/\s{3,}$/.test(textBefore)) {
                            log('Skipping: Ends with excessive whitespace');
                            return;
                        }

                        // Abort any previous request
                        if (currentRequest) {
                            currentRequest.abort();
                        }
                        currentRequest = new AbortController();

                        try {
                            log('Fetching suggestion...');
                            // Mark as loading (but don't show UI for it)
                            const loadingTr = view.state.tr.setMeta(autocompletePluginKey, { loading: true });
                            view.dispatch(loadingTr);

                            const suggestion = await options.getSuggestion(textBefore);
                            log('Suggestion received:', suggestion);

                            // Verify cursor hasn't moved while we were fetching
                            const currentFrom = view.state.selection.from;
                            if (currentFrom !== from) {
                                log('Discarding: Cursor moved');
                                return;
                            }

                            // Verify cursor is still at a good position
                            if (!isCursorAtGoodPosition(view.state)) {
                                log('Discarding: Bad cursor position');
                                return;
                            }

                            if (suggestion && suggestion.trim()) {
                                const cleanSuggestion = suggestion.trim();

                                // Don't show if suggestion is too long (likely hallucination)
                                if (cleanSuggestion.length > 100) {
                                    log('Discarding: Too long');
                                    return;
                                }

                                const tr = view.state.tr.setMeta(autocompletePluginKey, {
                                    suggestion: cleanSuggestion,
                                    position: view.state.selection.from,
                                });
                                view.dispatch(tr);
                            }
                        } catch (error) {
                            if (error instanceof Error && error.name !== 'AbortError') {
                                console.error('[Autocomplete] Error:', error);
                            }
                        }
                    };

                    return {
                        update(view, prevState) {
                            // Clear timer on any update
                            clearState();

                            // Only proceed if document changed
                            if (!view.state.doc.eq(prevState.doc)) {
                                // Check if this was actual text typing by comparing states
                                const wasTextInsertion = isTextInsertion(view.state, prevState);

                                if (wasTextInsertion) {
                                    // Track consecutive typing
                                    const now = Date.now();
                                    if (now - lastTypingTimestamp < 5000) {
                                        consecutiveTypingCount++;
                                    } else {
                                        consecutiveTypingCount = 1;
                                    }
                                    lastTypingTimestamp = now;

                                    log(`Typing detected! Count: ${consecutiveTypingCount}`);

                                    // Trigger after any typing (threshold = 1)
                                    if (consecutiveTypingCount >= 1) {
                                        log(`Scheduling fetch in ${options.debounceMs}ms`);
                                        debounceTimer = setTimeout(fetchSuggestion, options.debounceMs);
                                    }
                                } else {
                                    // Reset consecutive count on non-typing changes (deletions, pastes, etc.)
                                    log('Reset count: not text insertion (deletion or large paste)');
                                    consecutiveTypingCount = 0;
                                }
                            } else if (!view.state.selection.eq(prevState.selection)) {
                                // Selection changed without doc change = user navigating
                                log('Reset count: selection change');
                                consecutiveTypingCount = 0;
                            }
                        },

                        destroy() {
                            clearState();
                        },
                    };
                },
            }),
        ];
    },
});

export default AutocompletePlugin;
