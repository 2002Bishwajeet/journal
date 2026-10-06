import { toast } from 'sonner';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';

/** Downloads one note as `<title>.md`, with the title as a `# ` header above the body. */
export async function exportNoteAsMarkdown(noteId: string, noteTitle: string): Promise<void> {
    try {
        const markdown = await extractMarkdownFromYjs(noteId);
        const fullContent = `# ${noteTitle || 'Untitled'}\n\n${markdown}`;

        const blob = new Blob([fullContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${noteTitle || 'untitled'}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Failed to export:', err);
        toast.error('Failed to export note');
    }
}
