
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance } from 'tippy.js';
import { EmojiList } from './EmojiList';
import { suggestionItems } from './emojiData';
import { PluginKey } from '@tiptap/pm/state';

export const EmojiPluginKey = new PluginKey('emoji-suggestion');

export const EmojiExtension = Extension.create({
    name: 'emojiExtension',

    addOptions() {
        return {
            suggestion: {
                char: ':',
                pluginKey: EmojiPluginKey,
                command: ({ editor, range, props }: any) => {
                    editor
                        .chain()
                        .focus()
                        .insertContentAt(range, props.emoji + ' ')
                        .run();
                },
                items: suggestionItems,
                render: () => {
                    let component: ReactRenderer;
                    let popup: Instance[];

                    return {
                        onStart: (props: any) => {
                            component = new ReactRenderer(EmojiList, {
                                props,
                                editor: props.editor,
                            });

                            if (!props.clientRect) {
                                return;
                            }

                            popup = tippy('body', {
                                getReferenceClientRect: props.clientRect,
                                appendTo: () => document.body,
                                content: component.element,
                                showOnCreate: true,
                                interactive: true,
                                trigger: 'manual',
                                placement: 'bottom-start',
                            });
                        },

                        onUpdate(props: any) {
                            component.updateProps(props);

                            if (!props.clientRect) {
                                return;
                            }

                            popup[0].setProps({
                                getReferenceClientRect: props.clientRect,
                            });
                        },

                        onKeyDown(props: any) {
                            if (props.event.key === 'Escape') {
                                popup[0].hide();
                                return true;
                            }

                            return (component.ref as any)?.onKeyDown(props);
                        },

                        onExit() {
                            popup[0].destroy();
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
