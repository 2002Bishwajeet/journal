/**
 * Tiptap Extensions Configuration
 * 
 * This file contains all Tiptap extension configurations.
 * Add, remove, or modify extensions here to customize the editor.
 */

import { Extension, type RawCommands, type CommandProps } from '@tiptap/core';
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
import { ImageNodeView } from '../nodes/ImageNode';

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
        };
    },
    addNodeView() {
        return ReactNodeViewRenderer(ImageNodeView);
    },
}).configure({
    inline: true,
    allowBase64: true,
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
    ];
}
