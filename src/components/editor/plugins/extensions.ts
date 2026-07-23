/**
 * Tiptap Extensions Configuration
 * 
 * This file contains all Tiptap extension configurations.
 * Add, remove, or modify extensions here to customize the editor.
 */

import { Extension, type RawCommands, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Mathematics } from '@tiptap/extension-mathematics';
import { createLowlight } from 'lowlight';
import { EmojiExtension } from './EmojiExtension';
import { SearchAndReplace } from './SearchAndReplaceExtension';
import { ImageNodeView } from '../nodes/ImageNode';
import { ALIGN_STYLE, type ImageAlign } from '../nodes/imageLayout';

// Re-export FileHandler for use in EditorProvider
export { FileHandler } from './FileHandler';

// Initialize lowlight for code syntax highlighting
import { common } from 'lowlight';
const lowlight = createLowlight(common);

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

/**
 * Custom Image extension with NodeView for handling pending uploads and remote images
 */
const CustomImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            'data-pending-id': {
                default: null,
                parseHTML: element => element.getAttribute('data-pending-id'),
                renderHTML: attributes => {
                    if (!attributes['data-pending-id']) return {};
                    return { 'data-pending-id': attributes['data-pending-id'] };
                },
            },
            // Float alignment, set from the toolbar that appears on a selected
            // image. Distinct from the paragraph's TextAlign, which only shifts
            // the image within its line — a float lets the text wrap around it.
            align: {
                default: null,
                parseHTML: element => element.getAttribute('data-align'),
                renderHTML: attributes => {
                    const css = ALIGN_STYLE[attributes.align as ImageAlign];
                    if (!css) return {};
                    return {
                        'data-align': attributes.align,
                        style: Object.entries(css).map(([k, v]) => `${k}: ${v}`).join('; '),
                    };
                },
            },
            // Rendered width in px, set by dragging one of the image's corner
            // handles. Lives on the node, so it persists in the Yjs doc like any
            // other attr. No height: leaving it auto keeps the aspect ratio.
            width: {
                default: null,
                parseHTML: element => {
                    const w = parseInt(element.style.width || element.getAttribute('width') || '', 10);
                    return Number.isFinite(w) ? w : null;
                },
                renderHTML: attributes => {
                    if (!attributes.width) return {};
                    return { style: `width: ${attributes.width}px` };
                },
            },
        };
    },
    addNodeView() {
        return ReactNodeViewRenderer(ImageNodeView);
    },
}).configure({
    inline: true,
    allowBase64: true,
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
 * Type for extension configuration options
 */
export interface ExtensionOptions {
    placeholder?: string;
    linkClass?: string;
}

/**
 * Creates base extensions with custom options
 */
export function createBaseExtensions(options?: ExtensionOptions) {
    return [
        StarterKit.configure({
            codeBlock: false,
            undoRedo: false,
            link: false,
            underline: false,
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

        CustomImage,

        CodeBlockLowlight.configure({
            lowlight,
        }),

        Table.configure({
            resizable: true,
            lastColumnResizable: true,
        }),

        TableRow,
        TableCell,
        TableHeader,

        Mathematics,
        EmojiExtension,

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
        SplitHardBreaksOnPaste,
        SearchAndReplace,
    ];
}
