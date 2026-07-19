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
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { NoteLinkList, type NoteLinkListRef } from './NoteLinkList';
import { advancedSearch, getFrequentlyLinkedNotes, searchNotesByTitle } from '@/lib/db';

export type NoteLinkItem =
    | { type: 'note'; docId: string; title: string; section?: 'frequent' | 'recent' }
    | { type: 'create'; title: string };

export interface NoteLinkOptions {
    /** Create a new note titled `title`; return its docId (or null to abort). */
    onCreateNote: (title: string) => Promise<{ docId: string } | null>;
    /** The note currently being edited — excluded from results (no self-links). */
    getCurrentNoteId: () => string | undefined;
    suggestion: Partial<SuggestionOptions>;
}

type Range = { from: number; to: number };

const noteLinkContent = (noteId: string, label: string) => [
    { type: 'noteLink', attrs: { noteId, label } },
    { type: 'text', text: ' ' },
];

function insertNoteLink(editor: Editor, range: Range, noteId: string, label: string) {
    editor.chain().focus().deleteRange(range).insertContent(noteLinkContent(noteId, label)).run();
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
        // Monotonic id so a slow earlier query can't overwrite a newer result.
        let requestSeq = 0;
        return [
            Suggestion<NoteLinkItem>({
                editor: this.editor,
                // Unique key — the default shared 'suggestion' PluginKey collides
                // with the slash-command palette and crashes the editor.
                pluginKey: new PluginKey('note-link-suggestion'),
                char: '[[',
                allowSpaces: true,
                startOfLine: false,

                // Match `[[` then any chars except `]`, `[` or newline, up to the
                // cursor. Excluding `]` makes `]]` terminate the query (popup
                // closes) — the natural [[Title]] syntax, which the default
                // allowSpaces matcher would over-run to end of line.
                findSuggestionMatch: ({ $position }) => {
                    const textBefore = $position.parent.textBetween(
                        0,
                        $position.parentOffset,
                        undefined,
                        '￼',
                    );
                    const m = /\[\[([^[\]\n]*)$/.exec(textBefore);
                    if (!m) return null;
                    return {
                        range: { from: $position.pos - m[0].length, to: $position.pos },
                        query: m[1],
                        text: m[0],
                    };
                },

                ...options.suggestion,

                items: async ({ query }) => {
                    const seq = ++requestSeq;
                    // Stale result (a newer query started) — drop it instead of
                    // overwriting fresher items. Never-resolving = no onUpdate.
                    const stale = () => seq !== requestSeq;
                    const dropped = () => new Promise<NoteLinkItem[]>(() => {});
                    const excludeId = options.getCurrentNoteId();

                    if (query) {
                        // Debounce typed queries: wait out the keystroke burst so
                        // only the latest call hits the DB.
                        await new Promise((resolve) => setTimeout(resolve, 120));
                        if (stale()) return dropped();
                        // Same engine as the Cmd+K search modal — title, content
                        // and fuzzy matches, not just title substrings.
                        const results = await advancedSearch(query);
                        if (stale()) return dropped();
                        const items: NoteLinkItem[] = results
                            .filter((r) => r.docId !== excludeId && (r.metadata.archivalStatus ?? 0) === 0)
                            .slice(0, 8)
                            .map((r) => ({ type: 'note', docId: r.docId, title: r.title || 'Untitled' }));
                        const q = query.trim();
                        if (q) items.push({ type: 'create', title: q });
                        return items;
                    }

                    // Popup just opened (empty query, no debounce — it should
                    // appear immediately): most-linked notes, then recent to fill.
                    const [frequent, recent] = await Promise.all([
                        getFrequentlyLinkedNotes(excludeId, 4),
                        searchNotesByTitle('', excludeId, 8),
                    ]);
                    if (stale()) return dropped();
                    const seen = new Set(frequent.map((n) => n.docId));
                    const toItem =
                        (section: 'frequent' | 'recent') =>
                        (n: { docId: string; title: string }): NoteLinkItem =>
                            ({ type: 'note', docId: n.docId, title: n.title || 'Untitled', section });
                    return [
                        ...frequent.map(toItem('frequent')),
                        ...recent
                            .filter((n) => !seen.has(n.docId))
                            .slice(0, 8 - frequent.length)
                            .map(toItem('recent')),
                    ];
                },

                command: ({ editor, range, props }) => {
                    const item = props as NoteLinkItem;
                    if (item.type === 'note') {
                        insertNoteLink(editor, range, item.docId, item.title);
                        return;
                    }
                    // Create-on-the-fly: clear the `[[query`, create, then link at the
                    // same spot. On failure, restore the typed text so it isn't lost.
                    const from = range.from;
                    editor.chain().focus().deleteRange(range).run();
                    void options
                        .onCreateNote(item.title)
                        .then((res) => {
                            if (res?.docId) {
                                editor.chain().focus().insertContentAt(from, noteLinkContent(res.docId, item.title)).run();
                            } else {
                                editor.chain().focus().insertContentAt(from, `[[${item.title}`).run();
                            }
                        })
                        .catch((err) => {
                            console.error('[NoteLink] create note failed:', err);
                            editor.chain().focus().insertContentAt(from, `[[${item.title}`).run();
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
                            // The suggestion plugin dispatches a synchronous
                            // update with items: [] + loading: true on every
                            // keystroke before the async fetch resolves. Don't
                            // forward those — keep the previous results visible
                            // so the popup never flashes "No notes found"
                            // mid-search. Only reposition the popup.
                            if (!props.loading) component?.updateProps(props);
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
