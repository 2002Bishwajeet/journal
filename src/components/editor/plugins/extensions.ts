/**
 * Tiptap Extensions Configuration
 * 
 * This file contains all Tiptap extension configurations.
 * Add, remove, or modify extensions here to customize the editor.
 */

import { Extension, type AnyExtension, type RawCommands, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';

import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Mathematics } from '@tiptap/extension-mathematics';
import { createLowlight } from 'lowlight';
import { SearchAndReplace } from './SearchAndReplaceExtension';
import { ImageSchema } from '../nodes/imageSchema';
import { NoteLink } from '../nodes/NoteLinkNode';
import { LinkPreview } from '../nodes/LinkPreviewNode';
import { Toggle } from '../nodes/ToggleNode';
import { Callout } from '../nodes/CalloutNode';
import { Footnote, FootnoteReference, Footnotes } from '../nodes/FootnoteNodes';
import { parseCodeInfo } from '@/lib/liveBlocks';

// Re-export FileHandler for use in EditorProvider
export { FileHandler } from './FileHandler';

// Initialize lowlight for code syntax highlighting
import { common } from 'lowlight';
const lowlight = createLowlight(common);

// GFM has no headerless table, so an all-empty header line means "no header row" (#446).
const baseTableParseMarkdown = Table.config.parseMarkdown;
const HeaderlessAwareTable = Table.extend({
    parseMarkdown: (token, helpers) => {
        const header = token.header as { text?: string }[] | undefined;
        const emptyHeader = !!header && header.every((cell) => !cell.text?.trim());
        return baseTableParseMarkdown!(emptyHeader ? { ...token, header: undefined } : token, helpers);
    },
});
// A `react` live block's code is JSX, which the javascript grammar highlights (#426).
lowlight.registerAlias({ javascript: ['react'] });
// The `language` attribute is the fence's whole info string (```html id=k3f9, #410):
// highlight by its first word, the language.
const codeLanguage = (info: string) => parseCodeInfo(info).language ?? '';
const infoStringLowlight = {
    ...lowlight,
    registered: (info: string) => lowlight.registered(codeLanguage(info)),
    highlight: (info: string, value: string) => lowlight.highlight(codeLanguage(info), value),
};

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        duplicateBlock: {
            duplicateBlock: () => ReturnType;
        };
    }
}

const DuplicateBlock = Extension.create({
    name: 'duplicateBlock',
    addCommands() {
        return {
            duplicateBlock: () => ({ state, dispatch }: CommandProps) => {
                const { $from } = state.selection;
                const pos = $from.before($from.depth);
                const end = $from.after($from.depth);
                const node = state.doc.nodeAt(pos);
                if (!node) return false;
                if (dispatch) dispatch(state.tr.insert(end, node.copy(node.content)));
                return true;
            },
        } as Partial<RawCommands>;
    },
    addKeyboardShortcuts() {
        return {
            'Mod-Shift-d': () => this.editor.commands.duplicateBlock(),
        };
    },
});

const IndentExtension = Extension.create({
    name: 'indent',
    addGlobalAttributes() {
        return [{
            types: ['paragraph', 'heading'],
            attributes: {
                indent: {
                    default: 0,
                    parseHTML: element => parseInt(element.getAttribute('data-indent') || '0', 10),
                    renderHTML: attributes => {
                        if (!attributes.indent) return {};
                        return {
                            'data-indent': attributes.indent,
                            style: `padding-left: ${attributes.indent * 2}rem`,
                        };
                    },
                },
            },
        }];
    },
    addKeyboardShortcuts() {
        return {
            'Tab': () => {
                if (this.editor.isActive('listItem') || this.editor.isActive('taskItem') || this.editor.isActive('table')) {
                    return false;
                }
                const nodeType = this.editor.state.selection.$from.parent.type.name;
                if (!['paragraph', 'heading'].includes(nodeType)) return false;
                const current = this.editor.getAttributes(nodeType).indent || 0;
                if (current >= 8) return false;
                return this.editor.chain().updateAttributes(nodeType, { indent: current + 1 }).run();
            },
            'Shift-Tab': () => {
                if (this.editor.isActive('listItem') || this.editor.isActive('taskItem') || this.editor.isActive('table')) {
                    return false;
                }
                const nodeType = this.editor.state.selection.$from.parent.type.name;
                if (!['paragraph', 'heading'].includes(nodeType)) return false;
                const current = this.editor.getAttributes(nodeType).indent || 0;
                if (current <= 0) return false;
                return this.editor.chain().updateAttributes(nodeType, { indent: current - 1 }).run();
            },
        };
    },
});

/**
 * Deletes an empty top-level textblock at the very START of the document when
 * another block follows it. StarterKit's Backspace (joinBackward) is a no-op
 * there — nothing precedes the block to merge into — so a stray blank line above
 * a list, horizontal rule, or image otherwise can't be removed. Pure command so
 * it's unit-testable at the ProseMirror state level.
 */
export function deleteEmptyLeadingBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    if ($from.depth !== 1 || !$from.parent.isTextblock) return false; // top-level textblock only
    if ($from.parent.content.size > 0) return false;                  // must be empty
    if ($from.before() !== 0) return false;                           // must be the first block
    if (state.doc.childCount < 2) return false;                       // keep the last block
    if (dispatch) dispatch(state.tr.delete(0, $from.after()));
    return true;
}

const DeleteEmptyLeadingBlock = Extension.create({
    name: 'deleteEmptyLeadingBlock',
    addKeyboardShortcuts() {
        return {
            Backspace: () =>
                this.editor.commands.command(({ state, dispatch }) => deleteEmptyLeadingBlock(state, dispatch)),
        };
    },
});

const ClearFormattingShortcut = Extension.create({
    name: 'clearFormatting',
    addKeyboardShortcuts() {
        return {
            'Mod-\\': () => this.editor.chain().clearNodes().unsetAllMarks().run(),
        };
    },
});

const CustomTextAlign = TextAlign.extend({
    addKeyboardShortcuts() {
        return {
            'Mod-Shift-l': () => this.editor.commands.setTextAlign('left'),
            'Mod-Shift-e': () => this.editor.commands.setTextAlign('center'),
            'Mod-Shift-r': () => this.editor.commands.setTextAlign('right'),
            'Mod-Shift-j': () => this.editor.commands.setTextAlign('justify'),
        };
    },
});

function fragmentHasHardBreak(frag: Fragment): boolean {
    let found = false;
    frag.forEach(child => { if (child.type.name === 'hardBreak') found = true; });
    return found;
}

// Split an inline fragment into nodes of `type`, breaking at each hardBreak.
function splitAtHardBreaks(frag: Fragment, type: PMNode['type'], attrs?: PMNode['attrs'], marks?: PMNode['marks']): PMNode[] {
    const out: PMNode[] = [];
    let buffer: PMNode[] = [];
    const flush = () => { out.push(type.create(attrs, buffer.length ? Fragment.fromArray(buffer) : null, marks)); buffer = []; };
    frag.forEach(child => { if (child.type.name === 'hardBreak') flush(); else buffer.push(child); });
    flush();
    return out;
}

function splitBlockFragment(frag: Fragment): Fragment {
    const out: PMNode[] = [];
    frag.forEach(node => {
        if (node.isTextblock && fragmentHasHardBreak(node.content)) {
            out.push(...splitAtHardBreaks(node.content, node.type, node.attrs, node.marks));
        } else if (!node.isText && node.content.size > 0) {
            out.push(node.copy(splitBlockFragment(node.content)));
        } else {
            out.push(node);
        }
    });
    return Fragment.fromArray(out);
}

/**
 * Multi-line content pasted from the web (YouTube comments, Notion, chat apps, …)
 * arrives as a single block whose lines are joined by <br> hard-breaks. Block-level
 * formatting (headings, lists) then applies to the WHOLE block — selecting one line
 * and pressing "Heading 2" converts every line, and toggling a list collapses
 * everything into one un-exitable list item. Splitting those hard-breaks into real
 * paragraphs on paste makes each line independently formattable. Only runs on paste,
 * so soft breaks typed with Shift+Enter inside the editor are left untouched, and
 * code-block pastes (plain text, no hardBreak nodes) pass through unchanged.
 */
export function splitHardBreaksSlice(slice: Slice, schema: Schema): Slice {
    const first = slice.content.firstChild;
    if (!first) return slice;
    if (first.isInline) {
        if (!fragmentHasHardBreak(slice.content)) return slice;
        const paragraphs = splitAtHardBreaks(slice.content, schema.nodes.paragraph);
        // openStart/End = 1 so the first/last lines merge into the surrounding
        // block when pasting into the middle of an existing paragraph.
        return new Slice(Fragment.fromArray(paragraphs), 1, 1);
    }
    return new Slice(splitBlockFragment(slice.content), slice.openStart, slice.openEnd);
}

const SplitHardBreaksOnPaste = Extension.create({
    name: 'splitHardBreaksOnPaste',
    addProseMirrorPlugins() {
        const editor = this.editor;
        return [
            new Plugin({
                key: new PluginKey('splitHardBreaksOnPaste'),
                props: {
                    transformPasted: slice => splitHardBreaksSlice(slice, editor.schema),
                },
            }),
        ];
    },
});

/**
 * Pasted plain text that should become a code block: one whole fenced block
 * (```lang … ```), or bare markup that starts with a tag and ends with one
 * (`svg` when the root is `<svg>`, otherwise `html`). Null for anything else.
 * A fence's `language` is its whole info string, as a markdown import keeps it,
 * so an id or `wide` in it stays with the block (#557).
 */
export function codeBlockFromPaste(text: string): { language: string | null; code: string } | null {
    const trimmed = text.replace(/\r\n?/g, '\n').trim();
    const fence = trimmed.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/);
    // A fence line inside the body means several blocks were pasted; leave those alone.
    if (fence) return /^```/m.test(fence[2]) ? null : { language: fence[1].trim() || null, code: fence[2] };
    // Lower-case tag names only, so pasted JSX (<Component>) stays text.
    if (/^<(!doctype html|[a-z][\w-]*)[\s>]/i.test(trimmed) && !/^<[A-Z]/.test(trimmed) && /<\/[a-z][\w-]*>$/.test(trimmed)) {
        return { language: /^<svg[\s>]/.test(trimmed) ? 'svg' : 'html', code: trimmed };
    }
    return null;
}

/**
 * Pasting a fenced block or bare markup into an empty paragraph makes a code
 * block of it, so an ```html / ```mermaid / <div>… paste previews as a live block
 * instead of landing as literal text.
 */
const PasteAsCodeBlock = Extension.create({
    name: 'pasteAsCodeBlock',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('pasteAsCodeBlock'),
                props: {
                    handlePaste(view, event) {
                        const data = event.clipboardData;
                        // VS Code pastes are handled by the code block extension, which knows the language.
                        if (!data || data.types.includes('vscode-editor-data')) return false;
                        const { $from, empty } = view.state.selection;
                        const codeBlock = view.state.schema.nodes.codeBlock;
                        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) return false;
                        if (!$from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), codeBlock)) return false;
                        const block = codeBlockFromPaste(data.getData('text/plain'));
                        if (!block) return false;
                        const node = codeBlock.create(
                            { language: block.language },
                            block.code ? view.state.schema.text(block.code) : undefined,
                        );
                        view.dispatch(view.state.tr.replaceRangeWith($from.before(), $from.after(), node));
                        return true;
                    },
                },
            }),
        ];
    },
});

/**
 * Type for extension configuration options
 */
export interface ExtensionOptions {
    placeholder?: string;
    linkClass?: string;
    /** Image node; defaults to the headless ImageSchema (the editor passes one with a React node view). */
    image?: typeof ImageSchema;
    /** Note-link node; defaults to the headless NoteLink (the editor passes one with a React node view). */
    noteLink?: typeof NoteLink;
    /** Link preview card; defaults to the headless LinkPreview (the editor passes one with a React node view). */
    linkPreview?: typeof LinkPreview;
    /** Toggle node; defaults to the headless Toggle (the editor passes one with a React node view). */
    toggle?: typeof Toggle;
    /** Callout node; defaults to the headless Callout (the editor passes one with a React node view). */
    callout?: typeof Callout;
    /** UI-only extensions that add no schema (e.g. the emoji popup), placed after Mathematics. */
    uiExtensions?: AnyExtension[];
}

/**
 * Every extension that contributes a node or mark to the editor schema, plus
 * editor behaviour. With no options it is headless (no React), so the agent
 * edit engine (#316) and the editor share one schema and can't drift.
 */
export function createBaseExtensions(options?: ExtensionOptions) {
    return [
        StarterKit.configure({
            codeBlock: false,
            undoRedo: false,
            link: false,
            underline: false,
            // The footnotes section stays last (#518).
            trailingNode: { notAfter: ['footnotes'] },
        }),

        Placeholder.configure({
            placeholder: options?.placeholder ?? 'Start writing...',
            emptyEditorClass: 'is-editor-empty',
        }),

        Link.configure({
            openOnClick: true,
            autolink: true,
            linkOnPaste: true,
            HTMLAttributes: {
                class: options?.linkClass ?? 'text-blue-500 underline cursor-pointer',
                target: '_blank',
                rel: 'noopener noreferrer',
            },
        }),

        TaskList,

        TaskItem.configure({
            nested: true,
        }),

        options?.image ?? ImageSchema,

        CodeBlockLowlight.configure({
            lowlight: infoStringLowlight,
        }),

        HeaderlessAwareTable.configure({
            resizable: true,
            lastColumnResizable: true,
        }),

        TableRow,
        TableCell,
        TableHeader,

        Mathematics,
        ...(options?.uiExtensions ?? []),

        Underline,
        Subscript,
        Superscript,
        CustomTextAlign.configure({
            types: ['heading', 'paragraph'],
        }),
        ClearFormattingShortcut,
        DuplicateBlock,
        IndentExtension,
        DeleteEmptyLeadingBlock,
        PasteAsCodeBlock,
        SplitHardBreaksOnPaste,
        SearchAndReplace,
        options?.noteLink ?? NoteLink,
        options?.linkPreview ?? LinkPreview,
        options?.toggle ?? Toggle,
        options?.callout ?? Callout,
        FootnoteReference,
        Footnotes,
        Footnote,
    ];
}
