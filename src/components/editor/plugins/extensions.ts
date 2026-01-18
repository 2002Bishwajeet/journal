/**
 * Tiptap Extensions Configuration
 * 
 * This file contains all Tiptap extension configurations.
 * Add, remove, or modify extensions here to customize the editor.
 */

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
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
        }),

        Placeholder.configure({
            placeholder: options?.placeholder ?? 'Start writing...',
            emptyEditorClass: 'is-editor-empty',
        }),

        Link.configure({
            openOnClick: true,
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
    ];
}
