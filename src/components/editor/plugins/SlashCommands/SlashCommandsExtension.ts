/**
 * Slash Commands Extension for TipTap
 * 
 * Provides a command palette triggered by typing "/" in the editor.
 * Uses @tiptap/suggestion for the popup mechanics.
 */

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { SlashCommandList, type SlashCommandListRef } from './SlashCommandList';
import { availableSlashItems, filterCommands } from './slashCommandItems';
import { createSpacedSuggestionMatch } from '../suggestionSearch';
import { viewportResizeProps } from '../suggestionViewport';

export interface SlashCommandsOptions {
    suggestion: Partial<SuggestionOptions>;
}

export const SlashCommandsExtension = Extension.create<SlashCommandsOptions>({
    name: 'slashCommands',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                // `/heading 4` keeps the menu open; a double space or a
                // query with no match closes it, so prose after `/` is left alone.
                allowSpaces: true,
                findSuggestionMatch: createSpacedSuggestionMatch('/'),
                shouldShow: ({ query }) => filterCommands(availableSlashItems(), query).length > 0,
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
                // Unique key — the default shared 'suggestion' PluginKey collides
                // with the note-link suggestion and crashes the editor.
                pluginKey: new PluginKey('slash-commands'),
                ...this.options.suggestion,
                items: ({ query }) => filterCommands(availableSlashItems(), query),
                render: () => {
                    let component: ReactRenderer<SlashCommandListRef> | null = null;
                    let popup: TippyInstance[] | null = null;
                    let docked = false;

                    return {
                        onStart: (props) => {
                            // On a phone the keyboard toolbar has a dock: the menu sits above it (#827).
                            const dock = document.querySelector('[data-slash-dock]');
                            docked = !!dock;
                            component = new ReactRenderer(SlashCommandList, {
                                props: { ...props, docked },
                                editor: props.editor,
                            });

                            if (!props.clientRect) return;
                            if (dock) {
                                dock.append(component.element);
                                return;
                            }

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
                                ...viewportResizeProps,
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
                                if (docked && component) component.element.hidden = true;
                                return true;
                            }

                            return component?.ref?.onKeyDown(props) ?? false;
                        },

                        onExit: () => {
                            popup?.[0]?.destroy();
                            if (docked) component?.element.remove();
                            component?.destroy();
                        },
                    };
                },
            }),
        ];
    },
});

export default SlashCommandsExtension;
