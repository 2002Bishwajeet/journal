import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSharePage } from '@/hooks/useSharePage';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import 'katex/dist/katex.min.css';

// The serializer emits author-controlled raw HTML (<u>/<sub>/<sup> marks) on top
// of `$...$` math. On a PUBLIC page that HTML must be sanitized to prevent XSS,
// so the rehype order is: parse raw HTML -> sanitize -> render math. KaTeX runs
// LAST so its (trusted) markup isn't stripped. We only widen the default schema
// to allow the three formatting tags; remark-math's class markers ride on <code>,
// which the default schema already permits, so KaTeX still finds the math.
const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'sub', 'sup'],
};

/**
 * Public page to display a shared note.
 */
export default function SharePage() {
    const { identity, note, isLoading, error } = useSharePage();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading shared note...</p>
                </div>
            </div>
        );
    }

    if (error || !note) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center space-y-4">
                    <FileText className="h-16 w-16 text-muted-foreground/50 mx-auto" />
                    <h1 className="text-2xl font-semibold">Note Not Found</h1>
                    <p className="text-muted-foreground">
                        {error instanceof Error ? error.message : 'This note may have been deleted or is not publicly shared.'}
                    </p>
                    <Button asChild variant="outline">
                        <Link to="/">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Go to Journal
                        </Link>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="border-b bg-muted/30">
                <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FileText className="h-6 w-6 text-primary" />
                        <span className="font-semibold">Shared Note</span>
                    </div>
                    <Button asChild variant="outline" size="sm">
                        <Link to="/">
                            Open Journal
                        </Link>
                    </Button>
                </div>
            </header>

            {/* Content */}
            <main className="container max-w-4xl mx-auto px-4 py-8">
                <article className="prose prose-neutral dark:prose-invert max-w-none">
                    <h1>{note.title}</h1>
                    <div className="text-sm text-muted-foreground mb-8">
                        Shared by: {identity}
                    </div>
                    
                    <Markdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
                    >
                        {note.content}
                    </Markdown>
                </article>
            </main>

            {/* Footer */}
            <footer className="border-t mt-16">
                <div className="container max-w-4xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
                    <p>This note was shared via Journal</p>
                </div>
            </footer>
        </div>
    );
}
