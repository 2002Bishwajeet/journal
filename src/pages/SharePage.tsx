import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSharePage } from '@/hooks/useSharePage';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { PublicNoteImage } from '@/components/share/PublicNoteImage';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { formatShareDate, showUpdated } from '@/lib/share/articleMeta';
import 'katex/dist/katex.min.css';

/**
 * Public page to display a shared note.
 */
export default function SharePage() {
    const { identity, note, isLoading, error, author, readingMinutes } = useSharePage();
    useDocumentTitle(note?.title ?? 'Shared note');

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

    if (error || !note || !identity) {
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
                <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="text-lg font-semibold tracking-tight">
                        Journal
                    </Link>
                    <Button asChild variant="outline" size="sm">
                        <Link to="/">
                            Open Journal
                        </Link>
                    </Button>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
                <article className="prose prose-neutral dark:prose-invert max-w-none">
                    <h1>{note.title}</h1>
                    <div className="not-prose mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <Avatar className="h-8 w-8">
                            {author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
                            <AvatarFallback>{author.name.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="font-semibold text-foreground">{author.name}</span>
                        <span>
                            · Published <time dateTime={note.createdAt}>{formatShareDate(note.createdAt)}</time>
                        </span>
                        {showUpdated(note.createdAt, note.updatedAt) && (
                            <span>
                                · Updated <time dateTime={note.updatedAt}>{formatShareDate(note.updatedAt)}</time>
                            </span>
                        )}
                        {readingMinutes > 0 && <span>· {readingMinutes} min read</span>}
                    </div>

                    <Markdown
                        remarkPlugins={shareRemarkPlugins}
                        rehypePlugins={shareRehypePlugins}
                        urlTransform={(url) => (url.startsWith('attachment://') ? url : defaultUrlTransform(url))}
                        components={{
                            img: ({ src, alt, node, ...rest }) => {
                                // `node` is react-markdown's own extra prop, not a DOM attribute —
                                // exclude it before spreading the rest (title, etc.) onto <img>.
                                void node;
                                return src?.startsWith('attachment://') ? (
                                    <PublicNoteImage
                                        key={src}
                                        identity={decodeURIComponent(identity)}
                                        noteFileId={note.fileId}
                                        src={src}
                                        alt={alt}
                                    />
                                ) : (
                                    <img src={src} alt={alt} loading="lazy" {...rest} />
                                );
                            },
                            // Wide tables scroll within the column instead of widening the page on phones.
                            table: ({ node, ...rest }) => {
                                void node;
                                return (
                                    <div className="overflow-x-auto">
                                        <table {...rest} />
                                    </div>
                                );
                            },
                        }}
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
