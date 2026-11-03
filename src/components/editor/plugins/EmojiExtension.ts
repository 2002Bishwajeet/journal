
import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance } from 'tippy.js';
import { viewportResizeProps } from './suggestionViewport';
import { EmojiList } from './EmojiList';
import { loadEmojiKeywords, searchEmojis, suggestionItems } from './emojiData';
import { createSpacedSuggestionMatch } from './suggestionSearch';
import { PluginKey } from '@tiptap/pm/state';
import type { Editor, Range } from '@tiptap/core';

export const EmojiPluginKey = new PluginKey('emoji-suggestion');

// Types for TipTap suggestion render callbacks
interface SuggestionProps {
    editor: Editor;
    range: Range;
    query: string;
    text: string;
    clientRect?: (() => DOMRect | null) | null;
}

interface EmojiListRef {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const EmojiExtension = Extension.create({
    name: 'emojiExtension',

    addOptions() {
        return {
            suggestion: {
                char: ':',
                pluginKey: EmojiPluginKey,
                // `:thumbs up` keeps the menu open; a double space or a
                // query with no match closes it.
                allowSpaces: true,
                findSuggestionMatch: createSpacedSuggestionMatch(':'),
                shouldShow: ({ query }: { query: string }) => {
                    void loadEmojiKeywords();
                    return searchEmojis(query).length > 0;
                },
                command: ({ editor, range, props }: { editor: Editor; range: Range; props: { emoji: string } }) => {
                    editor
                        .chain()
                        .focus()
                        .insertContentAt(range, props.emoji + ' ')
                        .run();
                },
                items: suggestionItems,
                render: () => {
                    let component: ReactRenderer;
                    let popup: Instance;

                    return {
                        onStart: (props: SuggestionProps) => {
                            component = new ReactRenderer(EmojiList, {
                                props,
                                editor: props.editor,
                            });

                            if (!props.clientRect) {
                                return;
                            }

                            const clientRectFn = props.clientRect;
                            popup = tippy(document.body, {
                                getReferenceClientRect: () => clientRectFn() ?? new DOMRect(),
                                appendTo: () => document.body,
                                content: component.element,
                                showOnCreate: true,
                                interactive: true,
                                trigger: 'manual',
                                placement: 'bottom-start',
                                ...viewportResizeProps,
                            });
                        },

                        onUpdate(props: SuggestionProps) {
                            component.updateProps(props);

                            if (!props.clientRect) {
                                return;
                            }

                            const clientRectFn = props.clientRect;
                            popup.setProps({
                                getReferenceClientRect: () => clientRectFn() ?? new DOMRect(),
                            });
                        },

                        onKeyDown(props: SuggestionKeyDownProps) {
                            if (props.event.key === 'Escape') {
                                popup.hide();
                                return true;
                            }

                            return (component.ref as EmojiListRef | null)?.onKeyDown(props) ?? false;
                        },

                        onExit() {
                            popup.destroy();
                            component.destroy();
                        },
                    };
                },
            },
        };
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ];
    },
});
