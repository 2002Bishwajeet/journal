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

import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Mathematics } from '@tiptap/extension-mathematics';
import { createLowlight } from 'lowlight';
import { EmojiExtension } from './EmojiExtension';

// Initialize lowlight for code syntax highlighting
const lowlight = createLowlight();


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
            openOnClick: false,
            HTMLAttributes: {
                class: options?.linkClass ?? 'text-blue-500 underline cursor-pointer',
            },
        }),

        TaskList,

        TaskItem.configure({
            nested: true,
        }),

        Image.configure({
            inline: true,
            allowBase64: true,
        }),

        CodeBlockLowlight.configure({
            lowlight,
        }),



        Table.configure({
            resizable: true,
            lastColumnResizable: false,
        }),

        TableRow,
        TableCell,
        TableHeader,

        Mathematics,
        EmojiExtension,
    ];
}
