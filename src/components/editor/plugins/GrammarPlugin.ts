/**
 * Grammar Plugin for TipTap
 * 
 * Adds inline red wavy underlines for grammar/spelling errors.
 * Shows tooltip with error description on hover.
 * Only activates when AI is enabled and ready.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface GrammarError {
    text: string;
    message: string;
    from: number;
    to: number;
}

interface GrammarPluginOptions {
    checkGrammar: (text: string) => Promise<string[]>;
    isAIReadyRef: { current: boolean }; // React ref object
    debounceMs?: number;
    minCharsToCheck?: number;
    debug?: boolean;
}

interface GrammarState {
    errors: GrammarError[];
    isChecking: boolean;
    lastCheckedText: string | null;
}

const grammarPluginKey = new PluginKey<GrammarState>('grammar');

export const GrammarPlugin = Extension.create<GrammarPluginOptions>({
    name: 'grammar',

    addOptions() {
        return {
            checkGrammar: async () => [],
            isAIReadyRef: { current: false }, // Default ref-like object
            debounceMs: 3000,
            minCharsToCheck: 20,
            debug: false,
        };
    },

    addProseMirrorPlugins() {
        const options = this.options;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let currentRequest: AbortController | null = null;

        const log = (message: string, ...args: unknown[]) => {
            if (options.debug) {
                console.log(`[Grammar] ${message}`, ...args);
            }
        };

        return [
            new Plugin<GrammarState>({
                key: grammarPluginKey,

                state: {
                    init(): GrammarState {
                        return { errors: [], isChecking: false, lastCheckedText: null };
                    },

                    apply(tr, value): GrammarState {
                        const meta = tr.getMeta(grammarPluginKey);
                        if (meta?.errors !== undefined) {
                            return {
                                errors: meta.errors,
                                isChecking: false,
                                lastCheckedText: meta.checkedText || null,
                            };
                        }
                        if (meta?.checking) {
                            return { ...value, isChecking: true };
                        }
                        if (meta?.clear) {
                            return { errors: [], isChecking: false, lastCheckedText: null };
                        }

                        // Map positions if document changed
                        if (tr.docChanged && value.errors.length > 0) {
                            const mappedErrors = value.errors
                                .map((error) => ({
                                    ...error,
                                    from: tr.mapping.map(error.from),
                                    to: tr.mapping.map(error.to),
                                }))
                                .filter((error) => error.from < error.to);

                            return { ...value, errors: mappedErrors };
                        }

                        return value;
                    },
                },

                props: {
                    decorations(state) {
                        const pluginState = this.getState(state);
                        if (!pluginState?.errors.length) {
                            return DecorationSet.empty;
                        }

                        const decorations = pluginState.errors.map((error) =>
                            Decoration.inline(error.from, error.to, {
                                class: 'grammar-error',
                                'data-grammar-message': error.message,
                            })
                        );

                        return DecorationSet.create(state.doc, decorations);
                    },
                },

                view(view) {
                    // Create tooltip element
                    let tooltip: HTMLDivElement | null = null;

                    const showTooltip = (message: string, x: number, y: number) => {
                        if (!tooltip) {
                            tooltip = document.createElement('div');
                            tooltip.className = 'grammar-tooltip';
                            document.body.appendChild(tooltip);
                        }
                        tooltip.textContent = message;
                        tooltip.style.left = `${x}px`;
                        tooltip.style.top = `${y - 30}px`;
                        tooltip.style.display = 'block';
                    };

                    const hideTooltip = () => {
                        if (tooltip) {
                            tooltip.style.display = 'none';
                        }
                    };

                    // Mouse event handlers for tooltip
                    const handleMouseOver = (e: MouseEvent) => {
                        const target = e.target as HTMLElement;
                        if (target.classList.contains('grammar-error')) {
                            const message = target.getAttribute('data-grammar-message');
                            if (message) {
                                const rect = target.getBoundingClientRect();
                                showTooltip(message, rect.left, rect.top);
                            }
                        }
                    };

                    const handleMouseOut = (e: MouseEvent) => {
                        const target = e.target as HTMLElement;
                        if (target.classList.contains('grammar-error')) {
                            hideTooltip();
                        }
                    };

                    view.dom.addEventListener('mouseover', handleMouseOver);
                    view.dom.addEventListener('mouseout', handleMouseOut);

                    const checkGrammar = async () => {
                        if (!options.isAIReadyRef.current) {
                            log('Skipping: AI not ready');
                            return;
                        }

                        // Get full document text
                        const docText = view.state.doc.textContent;

                        // Check min length
                        if (docText.trim().length < (options.minCharsToCheck || 20)) {
                            log(`Skipping: Text too short (${docText.trim().length} chars)`);
                            return;
                        }

                        // Check if text has changed since last check
                        const currentState = grammarPluginKey.getState(view.state);
                        if (currentState?.lastCheckedText === docText) {
                            log('Skipping: Already checked this text');
                            return;
                        }

                        // Abort previous request
                        if (currentRequest) {
                            currentRequest.abort();
                        }
                        currentRequest = new AbortController();

                        try {
                            log('Checking grammar...');
                            // Mark as checking
                            const checkingTr = view.state.tr.setMeta(grammarPluginKey, { checking: true });
                            view.dispatch(checkingTr);

                            // Get text from first 500 chars (to limit API load)
                            const textToCheck = docText.slice(0, 500);
                            const errorDescriptions = await options.checkGrammar(textToCheck);
                            log(`Found ${errorDescriptions.length} potential errors`);

                            // Parse error descriptions and find positions in document
                            const errors: GrammarError[] = [];

                            for (const item of errorDescriptions) {
                                let description = '';
                                if (typeof item === 'string') {
                                    description = item;
                                } else if (typeof item === 'object' && item !== null) {
                                    // Handle case where LLM returns object (e.g. { error: "...", fixed: "..." })
                                    const obj = item as Record<string, unknown>;
                                    description = (typeof obj.message === 'string' ? obj.message : '') ||
                                        (typeof obj.error === 'string' ? obj.error : '') ||
                                        (typeof obj.description === 'string' ? obj.description : '') ||
                                        JSON.stringify(item);
                                } else {
                                    continue;
                                }

                                // Try to extract the problematic word from the description
                                // Common patterns: "word" should be, "word" is incorrect, etc.
                                const quotedMatch = description.match(/["']([^"']+)["']/);
                                if (quotedMatch) {
                                    const problemWord = quotedMatch[1];
                                    // Find all occurrences in the document
                                    view.state.doc.descendants((node, nodePos) => {
                                        if (node.isText && node.text) {
                                            const text = node.text;
                                            let idx = text.indexOf(problemWord);
                                            while (idx !== -1) {
                                                errors.push({
                                                    text: problemWord,
                                                    message: description,
                                                    from: nodePos + idx,
                                                    to: nodePos + idx + problemWord.length,
                                                });
                                                idx = text.indexOf(problemWord, idx + 1);
                                            }
                                        }
                                        return true;
                                    });
                                }
                            }

                            // Deduplicate by position
                            const uniqueErrors = errors.filter(
                                (error, index, self) =>
                                    index === self.findIndex((e) => e.from === error.from && e.to === error.to)
                            );

                            const tr = view.state.tr.setMeta(grammarPluginKey, {
                                errors: uniqueErrors,
                                checkedText: docText,
                            });
                            view.dispatch(tr);
                        } catch (error) {
                            if (error instanceof Error && error.name !== 'AbortError') {
                                console.error('[Grammar] Error:', error);
                            }
                        }
                    };

                    return {
                        update(view, prevState) {
                            // Debounce grammar check on document changes
                            if (!view.state.doc.eq(prevState.doc)) {
                                if (debounceTimer) {
                                    clearTimeout(debounceTimer);
                                }
                                debounceTimer = setTimeout(checkGrammar, options.debounceMs);
                            }
                        },

                        destroy() {
                            if (debounceTimer) {
                                clearTimeout(debounceTimer);
                            }
                            if (currentRequest) {
                                currentRequest.abort();
                            }
                            if (tooltip) {
                                tooltip.remove();
                            }
                            view.dom.removeEventListener('mouseover', handleMouseOver);
                            view.dom.removeEventListener('mouseout', handleMouseOut);
                        },
                    };
                },
            }),
        ];
    },
});

export default GrammarPlugin;
