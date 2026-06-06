/**
 * Note-link suggestion extension (`[[`).
 *
 * Triggered by typing `[[`, it searches notes by title and inserts a `noteLink`
 * node (see NoteLinkNode). When the query matches nothing it offers a
 * "Create '<query>'" action that creates a note and links it inline.
 * Reuses the same @tiptap/suggestion + ReactRenderer + tippy plumbing as the
 * slash-command palette.
 */
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { NoteLinkList, type NoteLinkListRef } from './NoteLinkList';
import { searchNotesByTitle } from '@/lib/db';

export type NoteLinkItem =
    | { type: 'note'; docId: string; title: string }
    | { type: 'create'; title: string };

export interface NoteLinkOptions {
    /** Create a new note titled `title`; return its docId (or null to abort). */
    onCreateNote: (title: string) => Promise<{ docId: string } | null>;
    /** The note currently being edited — excluded from results (no self-links). */
    getCurrentNoteId: () => string | undefined;
    suggestion: Partial<SuggestionOptions>;
}

type Range = { from: number; to: number };

function insertNoteLink(editor: Editor, range: Range, noteId: string, label: string) {
    editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
            { type: 'noteLink', attrs: { noteId, label } },
            { type: 'text', text: ' ' },
        ])
        .run();
}

export const NoteLinkExtension = Extension.create<NoteLinkOptions>({
    name: 'noteLinkSuggestion',

    addOptions() {
        return {
            onCreateNote: async () => null,
            getCurrentNoteId: () => undefined,
            suggestion: {},
        };
    },

    addProseMirrorPlugins() {
        const options = this.options;
        return [
            Suggestion<NoteLinkItem>({
                editor: this.editor,
                char: '[[',
                allowSpaces: true,
                startOfLine: false,
                ...options.suggestion,

                items: async ({ query }) => {
                    const notes = await searchNotesByTitle(query, options.getCurrentNoteId());
                    const items: NoteLinkItem[] = notes.map((n) => ({
                        type: 'note',
                        docId: n.docId,
                        title: n.title || 'Untitled',
                    }));
                    const q = query.trim();
                    if (q) items.push({ type: 'create', title: q });
                    return items;
                },

                command: ({ editor, range, props }) => {
                    const item = props as NoteLinkItem;
                    if (item.type === 'note') {
                        insertNoteLink(editor, range, item.docId, item.title);
                        return;
                    }
                    // Create-on-the-fly: clear the `[[query` first, then link once created.
                    editor.chain().focus().deleteRange(range).run();
                    void options.onCreateNote(item.title).then((res) => {
                        if (!res?.docId) return;
                        editor
                            .chain()
                            .focus()
                            .insertContent([
                                { type: 'noteLink', attrs: { noteId: res.docId, label: item.title } },
                                { type: 'text', text: ' ' },
                            ])
                            .run();
                    });
                },

                render: () => {
                    let component: ReactRenderer<NoteLinkListRef> | null = null;
                    let popup: TippyInstance[] | null = null;

                    return {
                        onStart: (props) => {
                            component = new ReactRenderer(NoteLinkList, {
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

export default NoteLinkExtension;
