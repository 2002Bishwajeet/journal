/**
 * Slash Command Items Definition
 * 
 * Defines all available commands in the slash menu, including
 * formatting options and AI-powered actions.
 */

import type { Editor } from '@tiptap/react';
import { aiRequests } from '@/lib/agent/aiRequests';
import {
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    Heading5,
    Heading6,
    List,
    ListOrdered,
    CheckSquare,
    Code,
    Quote,
    Table,
    Minus,
    Subscript,
    Superscript,
    Copy,
    Sparkles,
    FileText,
    Wand2,
    Image,
    Images,
    ListCollapse,
    MessageSquareWarning,
    ListEnd,
    type LucideIcon,
} from 'lucide-react';
import { safeEditorCommand } from '../../shared';
import { normalizeSearchText, rankSearch, type SearchTerms } from '../suggestionSearch';

export interface SlashCommandItem {
    title: string;
    description: string;
    /** Aliases the search matches as strongly as the title (e.g. `h4`, `todo`). */
    keywords: string[];
    icon: LucideIcon;
    group: 'formatting' | 'ai';
    command: (props: { editor: Editor; range: { from: number; to: number } }) => void;
}

/** Clears the slash text, then hands the image files picked (several allowed) to `insert`. */
function pickImages(editor: Editor, range: { from: number; to: number }, insert: (files: File[]) => void): void {
    editor.chain().focus().deleteRange(range).run();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
        safeEditorCommand(editor, () => insert(Array.from(input.files ?? [])));
    };
    input.click();
}

/**
 * Formatting commands - standard editor formatting options
 */
const formattingCommands: SlashCommandItem[] = [
    {
        title: 'Heading 1',
        description: 'Large section heading',
        keywords: ['h1', 'title', 'header'],
        icon: Heading1,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
        },
    },
    {
        title: 'Heading 2',
        description: 'Medium section heading',
        keywords: ['h2', 'subtitle', 'header'],
        icon: Heading2,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
        },
    },
    {
        title: 'Heading 3',
        description: 'Small section heading',
        keywords: ['h3', 'header'],
        icon: Heading3,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
        },
    },
    {
        title: 'Heading 4',
        description: 'Sub-section heading',
        keywords: ['h4', 'header'],
        icon: Heading4,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run();
        },
    },
    {
        title: 'Heading 5',
        description: 'Minor heading',
        keywords: ['h5', 'header'],
        icon: Heading5,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run();
        },
    },
    {
        title: 'Heading 6',
        description: 'Smallest heading',
        keywords: ['h6', 'header'],
        icon: Heading6,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run();
        },
    },
    {
        title: 'Bullet List',
        description: 'Create a bulleted list',
        keywords: ['ul', 'unordered list', 'bullets'],
        icon: List,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBulletList().run();
        },
    },
    {
        title: 'Numbered List',
        description: 'Create a numbered list',
        keywords: ['ol', 'ordered list', 'numbers'],
        icon: ListOrdered,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleOrderedList().run();
        },
    },
    {
        title: 'Task List',
        description: 'Create a to-do checklist',
        keywords: ['todo', 'to do', 'checkbox', 'checklist'],
        icon: CheckSquare,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleTaskList().run();
        },
    },
    {
        title: 'Code Block',
        description: 'Add a code snippet',
        keywords: ['code', 'snippet', 'pre'],
        icon: Code,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
        },
    },
    {
        title: 'Quote',
        description: 'Add a blockquote',
        keywords: ['blockquote', 'citation'],
        icon: Quote,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBlockquote().run();
        },
    },
    {
        title: 'Toggle',
        description: 'Collapsible section',
        keywords: ['collapse', 'details', 'accordion', 'expand'],
        icon: ListCollapse,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({ type: 'toggle', content: [{ type: 'paragraph' }] }).run();
        },
    },
    {
        title: 'Callout',
        description: 'Highlighted info, tip, warning or error box',
        keywords: ['info', 'tip', 'warning', 'error', 'alert', 'admonition'],
        icon: MessageSquareWarning,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run();
        },
    },
    {
        title: 'Footnote',
        description: 'Numbered note at the end of the page',
        keywords: ['reference', 'endnote'],
        icon: ListEnd,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertFootnote().run();
        },
    },
    {
        title: 'Table',
        description: 'Insert a table',
        keywords: ['grid', 'rows', 'columns'],
        icon: Table,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run();
        },
    },
    {
        title: 'Divider',
        description: 'Add a horizontal rule',
        keywords: ['hr', 'separator', 'line', 'rule'],
        icon: Minus,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHorizontalRule().run();
        },
    },
    {
        title: 'Image',
        description: 'Upload an image',
        keywords: ['img', 'picture', 'photo'],
        icon: Image,
        group: 'formatting',
        command: ({ editor, range }) => {
            pickImages(editor, range, (files) => editor.commands.insertImageFiles(files));
        },
    },
    {
        title: 'Gallery',
        description: 'Images side by side',
        keywords: ['images', 'grid', 'photos'],
        icon: Images,
        group: 'formatting',
        command: ({ editor, range }) => {
            pickImages(editor, range, (files) => editor.commands.insertImageGallery(files));
        },
    },
    {
        title: 'Subscript',
        description: 'Toggle subscript text',
        keywords: ['sub'],
        icon: Subscript,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleSubscript().run();
        },
    },
    {
        title: 'Superscript',
        description: 'Toggle superscript text',
        keywords: ['sup'],
        icon: Superscript,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleSuperscript().run();
        },
    },
    {
        title: 'Duplicate Block',
        description: 'Duplicate the current block (Cmd+Shift+D)',
        keywords: ['copy', 'clone'],
        icon: Copy,
        group: 'formatting',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            editor.commands.duplicateBlock();
        },
    },
];

/**
 * AI commands - these ask the assistant panel or the AI menu to act (see aiRequests)
 */
const aiCommands: SlashCommandItem[] = [
    {
        title: 'Ask AI',
        description: 'Ask AI a question about this note',
        keywords: ['ai', 'chat', 'question'],
        icon: Sparkles,
        group: 'ai',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            aiRequests.emit('ask');
        },
    },
    {
        title: 'Summarize',
        description: 'Generate a summary of this note',
        keywords: ['ai', 'summary', 'tldr'],
        icon: FileText,
        group: 'ai',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            aiRequests.emit('summarize');
        },
    },
    {
        title: 'Rewrite Selection',
        description: 'Rewrite selected text with AI',
        keywords: ['ai', 'rephrase', 'improve'],
        icon: Wand2,
        group: 'ai',
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            aiRequests.emit('rewrite');
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

const commandTerms = (item: SlashCommandItem): SearchTerms => ({
    names: [item.title, ...item.keywords].map(normalizeSearchText),
    keywords: [normalizeSearchText(item.description)],
});

/**
 * Filter and rank commands by search query (title and keywords first, then
 * description).
 */
export function filterCommands(items: SlashCommandItem[], query: string): SlashCommandItem[] {
    return rankSearch(items, query, commandTerms);
}
