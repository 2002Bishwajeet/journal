/**
 * Slash Commands Extension for TipTap
 * 
 * Provides a command palette triggered by typing "/" in the editor.
 * Uses @tiptap/suggestion for the popup mechanics.
 */

import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { SlashCommandList, type SlashCommandListRef } from './SlashCommandList';
import { slashCommandItems } from './slashCommandItems';

export interface SlashCommandsOptions {
    suggestion: Partial<SuggestionOptions>;
}

export const SlashCommandsExtension = Extension.create<SlashCommandsOptions>({
    name: 'slashCommands',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                allowSpaces: false,
                startOfLine: false, // Allow slash anywhere, not just start of line
                command: ({ editor, range, props }) => {
                    // This is called when a command is selected
                    // The actual command execution is handled by slashCommandItems
                    props.command({ editor, range });
                },
            },
        };
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
                items: ({ query }) => {
                    // Filter items based on query
                    const lowerQuery = query.toLowerCase().trim();
                    if (!lowerQuery) return slashCommandItems;

                    return slashCommandItems.filter(
                        item =>
                            item.title.toLowerCase().includes(lowerQuery) ||
                            item.description.toLowerCase().includes(lowerQuery)
                    );
                },
                render: () => {
                    let component: ReactRenderer<SlashCommandListRef> | null = null;
                    let popup: TippyInstance[] | null = null;

                    return {
                        onStart: (props) => {
                            component = new ReactRenderer(SlashCommandList, {
                                props,
                                editor: props.editor,
                            });

                            if (!props.clientRect) return;

                            popup = tippy('body', {
                                getReferenceClientRect: props.clientRect as () => DOMRect,
                                appendTo: () => document.body,
                                content: component.element,
                                showOnCreate: true,
                                interactive: true,
                                trigger: 'manual',
                                placement: 'bottom-start',
                                animation: 'shift-away',
                                offset: [0, 8],
                            });
                        },

                        onUpdate: (props) => {
                            component?.updateProps(props);

                            if (!props.clientRect || !popup?.[0]) return;

                            popup[0].setProps({
                                getReferenceClientRect: props.clientRect as () => DOMRect,
                            });
                        },

                        onKeyDown: (props) => {
                            if (props.event.key === 'Escape') {
                                popup?.[0]?.hide();
                                return true;
                            }

                            return component?.ref?.onKeyDown(props) ?? false;
                        },

                        onExit: () => {
                            popup?.[0]?.destroy();
                            component?.destroy();
                        },
                    };
                },
            }),
        ];
    },
});

export default SlashCommandsExtension;
