import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSharePage } from '@/hooks/useSharePage';
import { ShareHeader } from '@/components/share/ShareHeader';
import { ShareFooter } from '@/components/share/ShareFooter';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { PublicNoteImage } from '@/components/share/PublicNoteImage';
import { CalloutAwareBlockquote } from '@/components/share/CalloutAwareBlockquote';
import { ReaderTaskCheckbox } from '@/components/share/ReaderTaskCheckbox';
import { LiveBlockAwarePre } from '@/components/share/LiveBlockAwarePre';
import { LiveBlockStatesContext } from '@/components/share/liveBlockStatesContext';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { formatShareDate, showUpdated } from '@/lib/share/articleMeta';
import 'katex/dist/katex.min.css';

/**
 * Public page to display a shared note.
 */
export default function SharePage() {
    const { identity, noteId, note, isLoading, error, author, readingMinutes, cover } = useSharePage();
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

    if (error || !note || !identity || !noteId) {
        return (
            <div className="min-h-screen bg-background flex flex-col">
                <ShareHeader />
                {/* `m-auto`: centred in the space below the header. */}
                <div className="m-auto px-4 py-16 text-center space-y-4">
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
            <ShareHeader
                saveHref={`/save-shared?${new URLSearchParams({ identity: decodeURIComponent(identity), file: noteId })}`}
            />

            {/* Content */}
            <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
                {/* Outside the article so the global `.prose img` margin doesn't apply. */}
                {cover && (
                    <div className="mb-8 h-40 sm:h-56 w-full rounded-lg overflow-hidden">
                        <PublicNoteImage
                            key={cover.src}
                            identity={decodeURIComponent(identity)}
                            noteFileId={note.fileId}
                            src={cover.src}
                            alt=""
                            className="w-full h-full object-cover"
                            style={{ objectPosition: `50% ${cover.positionY}%` }}
                        />
                    </div>
                )}
                {/* `share-article`: see src/index.css, "Share page". */}
                <article className="share-article prose prose-neutral dark:prose-invert max-w-none">
                    <h1>{note.title}</h1>
                    <div className="not-prose mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <Avatar className="h-8 w-8">
                            {/* `!`: the global unlayered `.prose img` margin (1.5rem) would push the image out of its circle. */}
                            {author.avatarUrl && <AvatarImage className="m-0!" src={author.avatarUrl} alt="" />}
                            <AvatarFallback className="text-foreground">{author.name.charAt(0).toUpperCase()}</AvatarFallback>
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

                    <LiveBlockStatesContext.Provider value={note.blockStates ?? {}}>
                        <Markdown
                            remarkPlugins={shareRemarkPlugins}
                            rehypePlugins={shareRehypePlugins}
                            urlTransform={(url) => (url.startsWith('attachment://') ? url : defaultUrlTransform(url))}
                            components={{
                                blockquote: CalloutAwareBlockquote,
                                pre: LiveBlockAwarePre,
                                input: ReaderTaskCheckbox,
                                img: ({ src, alt, node, ...rest }) => {
                                    // `node` is react-markdown's own extra prop, not a DOM attribute —
                                    // exclude it before spreading the rest (title, etc.) onto <img>.
                                    void node;
                                    return (
                                        // Kept in the column; `block` so the image sits on its own line.
                                        <span className="share-wide block">
                                            {src?.startsWith('attachment://') ? (
                                                <PublicNoteImage
                                                    key={src}
                                                    identity={decodeURIComponent(identity)}
                                                    noteFileId={note.fileId}
                                                    src={src}
                                                    alt={alt}
                                                />
                                            ) : (
                                                <img src={src} alt={alt} loading="lazy" {...rest} />
                                            )}
                                        </span>
                                    );
                                },
                                // Same wrapper as the editor's (`.tableWrapper`): a table wider than the column scrolls inside it.
                                table: ({ node, ...rest }) => {
                                    void node;
                                    return (
                                        <div className="tableWrapper">
                                            <table {...rest} />
                                        </div>
                                    );
                                },
                            }}
                        >
                            {note.content}
                        </Markdown>
                    </LiveBlockStatesContext.Provider>
                </article>
            </main>

            <ShareFooter identity={decodeURIComponent(identity)} />
        </div>
    );
}
