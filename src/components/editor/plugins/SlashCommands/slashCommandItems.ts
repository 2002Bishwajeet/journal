/**
 * Slash Command Items Definition
 * 
 * Defines all available commands in the slash menu, including
 * formatting options and AI-powered actions.
 */

import type { Editor } from '@tiptap/react';
import {
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    CheckSquare,
    Code,
    Quote,
    Table,
    Minus,
    Sparkles,
    FileText,
    Wand2,
    type LucideIcon,
} from 'lucide-react';

export interface SlashCommandItem {
    title: string;
    description: string;
    icon: LucideIcon;
    group: 'formatting' | 'ai';
    command: (props: { editor: Editor; range: { from: number; to: number } }) => void;
}

/**
 * Formatting commands - standard editor formatting options
 */
const formattingCommands: SlashCommandItem[] = [
    {
        title: 'Heading 1',
        description: 'Large section heading',
        icon: Heading1,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
        },
    },
    {
        title: 'Heading 2',
        description: 'Medium section heading',
        icon: Heading2,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
        },
    },
    {
        title: 'Heading 3',
        description: 'Small section heading',
        icon: Heading3,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
        },
    },
    {
        title: 'Bullet List',
        description: 'Create a bulleted list',
        icon: List,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBulletList().run();
        },
    },
    {
        title: 'Numbered List',
        description: 'Create a numbered list',
        icon: ListOrdered,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleOrderedList().run();
        },
    },
    {
        title: 'Task List',
        description: 'Create a to-do checklist',
        icon: CheckSquare,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleTaskList().run();
        },
    },
    {
        title: 'Code Block',
        description: 'Add a code snippet',
        icon: Code,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
        },
    },
    {
        title: 'Quote',
        description: 'Add a blockquote',
        icon: Quote,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBlockquote().run();
        },
    },
    {
        title: 'Table',
        description: 'Insert a table',
        icon: Table,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        },
    },
    {
        title: 'Divider',
        description: 'Add a horizontal rule',
        icon: Minus,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHorizontalRule().run();
        },
    },
];

/**
 * AI commands - these trigger AI-powered actions
 * The actual AI processing is handled by the component that receives these commands
 */
const aiCommands: SlashCommandItem[] = [
    {
        title: 'Ask AI',
        description: 'Ask AI a question about this note',
        icon: Sparkles,
        group: 'ai',
        command: ({ editor, range }) => {
            // Delete the slash command, AI action will be handled by parent
            editor.chain().focus().deleteRange(range).run();
            // Dispatch custom event for AI action
            window.dispatchEvent(new CustomEvent('ai-slash-command', { detail: { action: 'ask' } }));
        },
    },
    {
        title: 'Summarize',
        description: 'Generate a summary of this note',
        icon: FileText,
        group: 'ai',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            window.dispatchEvent(new CustomEvent('ai-slash-command', { detail: { action: 'summarize' } }));
        },
    },
    {
        title: 'Rewrite Selection',
        description: 'Rewrite selected text with AI',
        icon: Wand2,
        group: 'ai',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            window.dispatchEvent(new CustomEvent('ai-slash-command', { detail: { action: 'rewrite' } }));
        },
    },
];

/**
 * All slash command items combined
 */
export const slashCommandItems: SlashCommandItem[] = [
    ...formattingCommands,
    ...aiCommands,
];

/**
 * Filter commands by search query
 */
export function filterCommands(items: SlashCommandItem[], query: string): SlashCommandItem[] {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return items;

    return items.filter(
        item =>
            item.title.toLowerCase().includes(lowerQuery) ||
            item.description.toLowerCase().includes(lowerQuery)
    );
}
