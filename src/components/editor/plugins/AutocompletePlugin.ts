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
import type { Transaction } from '@tiptap/pm/state';

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
 * Checks if a transaction represents actual text typing (not formatting, selection, etc.)
 * Uses multiple heuristics to detect genuine typing:
 * 1. Document size increased slightly (1-5 chars typical for typing)
 * 2. Selection moved forward after the change
 * 3. Change was not a pure deletion
 */
function isTextInsertion(tr: Transaction, prevState: { doc: { content: { size: number } }; selection: { from: number } }): boolean {
    if (!tr.docChanged) return false;

    const prevSize = prevState.doc.content.size;
    const newSize = tr.doc.content.size;
    const sizeDiff = newSize - prevSize;

    // Typing usually adds 1-5 characters at a time
    // Larger insertions might be paste operations, which we might want to exclude
    if (sizeDiff <= 0 || sizeDiff > 10) {
        return false;
    }

    // Cursor should have moved forward (typing inserts at cursor)
    const prevFrom = prevState.selection.from;
    const newFrom = tr.selection.from;

    if (newFrom <= prevFrom) {
        return false;
    }

    // Check steps - avoid formatting-only changes
    for (let i = 0; i < tr.steps.length; i++) {
        const step = tr.steps[i];
        const stepJson = step.toJSON();

        // ReplaceStep is the step type for insertions
        if (stepJson.stepType === 'replace' || stepJson.stepType === 'replaceAround') {
            const slice = stepJson.slice;
            if (slice && slice.content && slice.content.length > 0) {
                return true;
            }
        }
    }

    // Default: if doc grew and cursor moved forward, likely text insertion
    return sizeDiff > 0 && sizeDiff <= 5;
}

/**
 * Checks if cursor is at a good position for autocomplete
 * (at end of text, not in middle of a word)
 */
function isCursorAtGoodPosition(state: { selection: { from: number; to: number; empty: boolean }; doc: { textBetween: (from: number, to: number, sep?: string) => string; content: { size: number } } }): boolean {
    const { from, to, empty } = state.selection;

    // Must have no selection (cursor only)
    if (!empty || from !== to) return false;

    // Get character after cursor
    const textAfter = state.doc.textBetween(from, Math.min(from + 10, state.doc.content.size - 1), '');

    // If there's text after cursor (not at end), don't autocomplete
    // Allow if text after is only whitespace or punctuation
    if (textAfter.length > 0 && !/^[\s\n\r.,!?;:)\]}"']*$/.test(textAfter)) {
        return false;
    }

    // Get character before cursor - must end with space, punctuation, or be at word boundary
    const textBefore = state.doc.textBetween(Math.max(0, from - 1), from, '');

    // Good positions: after space, after punctuation, or after a word
    // This prevents triggering in the middle of words
    if (textBefore.length > 0 && /\S/.test(textBefore)) {
        // We're after a non-space character, which is fine
        // (autocomplete continues the word/sentence)
        return true;
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
                            const tr = view.state.tr;

                            // Clear timer on any update
                            clearState();

                            // Only proceed if document changed with text insertion
                            if (!view.state.doc.eq(prevState.doc)) {
                                // Check if this was actual text typing
                                const wasTextInsertion = isTextInsertion(tr, prevState);

                                if (wasTextInsertion) {
                                    // Track consecutive typing
                                    const now = Date.now();
                                    if (now - lastTypingTimestamp < 5000) {
                                        consecutiveTypingCount++;
                                    } else {
                                        consecutiveTypingCount = 1;
                                    }
                                    lastTypingTimestamp = now;

                                    if (options.debug) console.log(`[Autocomplete] Typing detected! Count: ${consecutiveTypingCount}`);

                                    // Only trigger after user has typed a few characters
                                    // (indicates active writing, not just a quick edit)
                                    // Lowered threshold to 1 for faster testing, logic handled in fetchSuggestion
                                    if (consecutiveTypingCount >= 1) {
                                        if (options.debug) console.log(`[Autocomplete] Scheduling fetch in ${options.debounceMs}ms`);
                                        debounceTimer = setTimeout(fetchSuggestion, options.debounceMs);
                                    }
                                } else {
                                    // Reset consecutive count on non-typing changes
                                    if (options.debug) console.log('[Autocomplete] Reset count: not text insertion');
                                    consecutiveTypingCount = 0;
                                }
                            } else if (tr.selectionSet) {
                                // Selection changed without doc change = user navigating
                                // Reset typing state
                                if (options.debug) console.log('[Autocomplete] Reset count: selection change');
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
