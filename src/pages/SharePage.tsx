import { useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSharePage } from '@/hooks/useSharePage';
import { useShareOutline } from '@/hooks/useShareOutline';
import { useThemePreference } from '@/hooks/useThemePreference';
import { ShareOutline } from '@/components/share/ShareOutline';
import { ShareHeader } from '@/components/share/ShareHeader';
import { ShareFooter } from '@/components/share/ShareFooter';
import { ShareUnavailable } from '@/components/share/ShareUnavailable';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PublicNoteImage } from '@/components/share/PublicNoteImage';
import { ShareNoteMarkdown } from '@/components/share/ShareNoteMarkdown';
import { formatShareDate, showUpdated } from '@/lib/share/articleMeta';
import 'katex/dist/katex.min.css';

/**
 * Public page to display a shared note. A note that is not public shows "no access"
 * (or, signed in, opens in the app when it was shared with the viewer); a missing one
 * shows "not found" (#1002).
 */
export default function SharePage() {
    const { identity, noteId, note, isLoading, error, forbidden, isAuthenticated, openSharedHref, author, readingMinutes, cover } = useSharePage();
    useDocumentTitle(note?.title ?? 'Shared note');
    // Follows the OS light/dark switch live unless the app's stored theme is Light or Dark.
    useThemePreference();
    const articleRef = useRef<HTMLElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const outline = useShareOutline(articleRef, note?.content ?? '');

    if (isLoading) {
        return (
            <div className="min-h-svh bg-background flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading shared note...</p>
                </div>
            </div>
        );
    }

    if (forbidden && openSharedHref) {
        // Signed in: the app opens the note when it was shared with this viewer.
        return isAuthenticated ? <Navigate to={openSharedHref} replace /> : <ShareUnavailable reason="noAccess" signInHref={openSharedHref} />;
    }

    if (error || !note || !identity || !noteId) {
        return <ShareUnavailable reason="notFound" />;
    }

    return (
        // The container a `wide` live block takes its width from (src/index.css, "Live blocks").
        <div className="@container/live-blocks min-h-dvh bg-background flex flex-col">
            <ShareHeader
                saveHref={`/save-shared?${new URLSearchParams({ identity: decodeURIComponent(identity), file: noteId })}`}
                authorIndexHref={`/share/${identity}`}
                onDownloadPdf={() => {
                    const main = mainRef.current;
                    if (main) void import('@/lib/importexport/printNote').then((m) => m.printElement(main, note.title));
                }}
            />

            {/* Content */}
            <main ref={mainRef} className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8">
                {/* Outside the article so the global `.prose img` margin doesn't apply. */}
                {cover && (
                    <div className="mb-8 h-40 sm:h-56 w-full rounded-lg overflow-hidden">
                        <PublicNoteImage
                            key={cover.src}
                            identity={decodeURIComponent(identity)}
                            noteFileId={note.fileId}
                            lastModified={note.lastModified}
                            src={cover.src}
                            alt=""
                            className="w-full h-full object-cover"
                            style={{ objectPosition: `50% ${cover.positionY}%` }}
                        />
                    </div>
                )}
                {/* `share-article`: see src/index.css, "Share page". */}
                {/* `data-outline-panel`: a wide block keeps clear of the panel (src/index.css, "Live blocks"). */}
                <article
                    ref={articleRef}
                    data-outline-panel={outline.headings.length > 0 && !outline.hidden ? '' : undefined}
                    className="share-article prose relative prose-neutral dark:prose-invert max-w-none"
                >
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

                    <ShareOutline headings={outline.headings} activeId={outline.activeId} hidden={outline.hidden} onToggleHidden={outline.toggleHidden} />

                    <ShareNoteMarkdown
                        content={note.content}
                        identity={decodeURIComponent(identity)}
                        noteFileId={note.fileId}
                        lastModified={note.lastModified}
                        imagePreviews={note.imagePreviews}
                        blockStates={note.blockStates}
                    />
                </article>
            </main>

            <ShareFooter identity={decodeURIComponent(identity)} />
        </div>
    );
}
