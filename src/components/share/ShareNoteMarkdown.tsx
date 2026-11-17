import { createContext, lazy, memo, Suspense, useContext, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown';
import { PublicNoteImage } from '@/components/share/PublicNoteImage';
import { EditedImage } from '@/components/EditedImage';
import { editDataAttrs, hasEdits, parseEditData } from '@/lib/images/imageEdits';
import { CalloutAwareBlockquote } from '@/components/share/CalloutAwareBlockquote';
import { GalleryAwareDiv } from '@/components/share/GalleryAwareDiv';
import { ReaderTaskCheckbox } from '@/components/share/ReaderTaskCheckbox';
import { LiveBlockAwarePre } from '@/components/share/LiveBlockAwarePre';
import { LiveBlockStatesContext } from '@/components/share/liveBlockStatesContext';
import { shareNoteLinkHref, shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

interface SharedNoteRef {
    /** The owner's identity, decoded. */
    identity: string;
    noteFileId: string;
    lastModified: number;
}

/** The note an attachment image loads from, for the module-scope `components` below. */
const SharedNoteContext = createContext<SharedNoteRef>({ identity: '', noteFileId: '', lastModified: 0 });

// Loaded on the first open, so the viewer stays out of the share page's first chunk.
const ImageLightbox = lazy(() => import('@/components/editor/nodes/ImageLightbox').then((m) => ({ default: m.ImageLightbox })));

/** How far a press may move and still be a tap, not a swipe of a carousel (#1357). */
const TAP_SLOP = 8;

// A note link (#616) is an in-app link, same tab.
function ShareLink({ node, href, ...rest }: ComponentProps<'a'> & ExtraProps) {
    void node;
    return href?.startsWith('/share/') ? <Link to={href} {...rest} /> : <a href={href} {...rest} />;
}

function ShareImage({ src, alt, node, width, ...rest }: ComponentProps<'img'> & ExtraProps) {
    const { identity, noteFileId, lastModified } = useContext(SharedNoteContext);
    // `node` is react-markdown's own extra prop, not a DOM attribute —
    // exclude it before spreading the rest (title, etc.) onto <img>.
    void node;
    // The editor's width and float (#581); the box carries both, the image fills it.
    const align = (rest as { 'data-align'?: string })['data-align'];
    const { 'data-caption': captionAttr, ...imgRest } = rest as { 'data-caption'?: string };
    const caption = captionAttr ?? alt;
    const px = Number(width) > 0 ? Number(width) : undefined;
    // Crop, rotate and flip (#584), drawn as in the editor
    const edits = parseEditData((name) => (rest as Record<string, string | undefined>)[name]);
    const edited = hasEdits(edits);
    const imgClass = edited ? 'block h-full w-full' : px ? 'w-full' : undefined;
    // The lightbox (#1357) shows the image as this page loaded it: the public payload's
    // object URL, or the plain URL. Kept after closing, so the dialog can fade out.
    const [fullSrc, setFullSrc] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const pressedAt = useRef<{ x: number; y: number } | null>(null);
    const openFull = (box: HTMLElement) => {
        if (box.closest('a')) return; // a linked image follows its link
        const img = box.querySelector('img');
        const loaded = img?.currentSrc || img?.getAttribute('src');
        if (!loaded) return; // still loading, or failed: nothing to enlarge
        setFullSrc(loaded);
        setOpen(true);
    };
    const picture = src?.startsWith('attachment://') ? (
        <PublicNoteImage key={src} identity={identity} noteFileId={noteFileId} lastModified={lastModified} src={src} alt={alt} className={imgClass} />
    ) : (
        <img src={src} alt={alt} loading="lazy" className={imgClass} {...imgRest} />
    );
    return (
        <>
            {/* Kept in the column; `block` so the image sits on its own line. A span, not a
                figure: the img sits inside a paragraph. A tap, click or Enter opens it full size. */}
            <span
                className="share-wide share-img block cursor-zoom-in"
                data-align={align}
                {...Object.fromEntries(editDataAttrs(edits))}
                style={px ? ({ '--share-img-width': `${px}px` } as CSSProperties) : undefined}
                role="button"
                tabIndex={0}
                aria-label={alt ? `${alt}, view full size` : 'View full size'}
                onPointerDown={(e) => {
                    pressedAt.current = { x: e.clientX, y: e.clientY };
                }}
                onClick={(e) => {
                    const at = pressedAt.current;
                    pressedAt.current = null;
                    // A drag (a carousel swipe with the mouse) ends in a click too; only a tap opens.
                    if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > TAP_SLOP) return;
                    openFull(e.currentTarget);
                }}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                    e.preventDefault();
                    openFull(e.currentTarget);
                }}
            >
                {edited ? (
                    <EditedImage key={src} edits={edits}>
                        {picture}
                    </EditedImage>
                ) : (
                    picture
                )}
                {/* The caption, else the alt text, as in the editor (#583); "" hides it */}
                {caption && (
                    <span data-testid="share-image-caption" aria-hidden={caption === alt || undefined} className="mt-1.5 block text-center text-sm text-muted-foreground">
                        {caption}
                    </span>
                )}
            </span>
            {/* A sibling, not a child: events in the dialog's portal bubble up the React tree. */}
            {fullSrc && (
                <Suspense fallback={null}>
                    <ImageLightbox open={open} onOpenChange={setOpen} src={fullSrc} alt={alt ?? ''} edits={edits} />
                </Suspense>
            )}
        </>
    );
}

// Same wrapper as the editor's (`.tableWrapper`): a table wider than the column scrolls inside it.
function ShareTable({ node, ...rest }: ComponentProps<'table'> & ExtraProps) {
    void node;
    return (
        <div className="tableWrapper">
            <table {...rest} />
        </div>
    );
}

/**
 * Module scope, so a page re-render (a new active outline heading) never gives react-markdown
 * new component types, which would remount every image, link and table (#1356).
 */
const components: Components = {
    a: ShareLink,
    blockquote: CalloutAwareBlockquote,
    div: GalleryAwareDiv,
    pre: LiveBlockAwarePre,
    input: ReaderTaskCheckbox,
    img: ShareImage,
    table: ShareTable,
};

interface ShareNoteMarkdownProps extends SharedNoteRef {
    content: string;
    blockStates?: Record<string, string>;
}

/** A shared note's body. Memoized: it re-renders only when the note does, not on scroll-spy updates. */
export const ShareNoteMarkdown = memo(function ShareNoteMarkdown({ content, identity, noteFileId, lastModified, blockStates }: ShareNoteMarkdownProps) {
    return (
        <SharedNoteContext.Provider value={{ identity, noteFileId, lastModified }}>
            <LiveBlockStatesContext.Provider value={blockStates ?? {}}>
                <Markdown
                    remarkPlugins={shareRemarkPlugins}
                    rehypePlugins={shareRehypePlugins}
                    urlTransform={(url) => {
                        const href = shareNoteLinkHref(url, identity);
                        return href.startsWith('attachment://') || href.startsWith('/share/') ? href : defaultUrlTransform(href);
                    }}
                    components={components}
                >
                    {content}
                </Markdown>
            </LiveBlockStatesContext.Provider>
        </SharedNoteContext.Provider>
    );
});
