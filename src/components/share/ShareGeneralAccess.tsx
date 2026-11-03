import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Copy, ExternalLink, Check, Eye, Loader2, Globe, Lock, Link2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShareCardPreview } from '@/components/share/ShareCardPreview';
import { useAuth } from '@/hooks/auth';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import type { useMakeNotesPublic } from '@/hooks/useMakeNotesPublic';
import { useShareCardPreview } from '@/hooks/useShareCardPreview';
import { useShareCardImage } from '@/hooks/useShareCardImage';
import type { ShareCardPatch } from '@/lib/share/publicCard';
import type { DocumentMetadata } from '@/types';
import { toast } from 'sonner';

type Publishing = ReturnType<typeof useMakeNotesPublic>;

/** A calm line saying what the current state means: information, not a warning. */
export function Notice({ id, icon: Icon, children }: { id?: string; icon: LucideIcon; children: ReactNode }) {
    return (
        <p id={id} className="flex gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-pretty">
            <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span>{children}</span>
        </p>
    );
}

/** The link card the public link unfurls with: the same 1200×630 image (og:image). */
export function ShareLinkPreview({ noteId, noteTitle, isPublic }: { noteId: string; noteTitle: string; isPublic: boolean }) {
    const cardPreview = useShareCardPreview(noteId);
    const cardImage = useShareCardImage(noteId, cardPreview.cardImageFrom, isPublic);
    return (
        <div className="flex w-full max-w-[500px] flex-col gap-3">
            <h3 id="share-preview-heading" className="text-sm leading-5 font-medium text-muted-foreground">
                Link preview
            </h3>
            <ShareCardPreview
                title={noteTitle || 'Untitled'}
                description={cardPreview.description}
                domain={window.location.host}
                image={cardImage ? (
                    <img src={cardImage} alt="" className="h-full w-full object-cover" />
                ) : undefined}
            />
        </div>
    );
}

interface ShareGeneralAccessProps {
    noteId: string;
    metadata: DocumentMetadata | undefined;
    publishing: Publishing;
    /** Turn the public link on, and publish `extraIds` (private notes it links to) too. */
    onMakePublic: (extraIds: string[]) => void;
    /** The "links to private notes" step is open. Held by the dialog, so it survives the dialog/sheet switch. */
    askingAboutLinks: boolean;
    setAskingAboutLinks: (asking: boolean) => void;
}

/**
 * "General access" (#682): restricted, or anyone with the link can view. On, it shows the
 * link with copy, the link-card settings and the way to turn it off (the old Share dialog).
 */
export function ShareGeneralAccess({ noteId, metadata, publishing, onMakePublic, askingAboutLinks, setAskingAboutLinks }: ShareGeneralAccessProps) {
    const { getIdentity } = useAuth();
    const { setShareCard } = useNotes();
    const { syncNote } = useSyncService();
    const cardPreview = useShareCardPreview(noteId);
    const { privateLinks, isMakingPublic, isMakingPrivate, makePrivate } = publishing;
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [copied, setCopied] = useState(false);

    const isPublic = !!metadata?.isPublic;
    const shareDescription = metadata?.shareDescription ?? '';
    const unlisted = metadata?.shareUnlisted === true;
    const identity = getIdentity() || 'unknown';
    const shareUrl = `${window.location.origin}/share/${encodeURIComponent(identity)}/${noteId}`;

    useEffect(() => () => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    }, []);

    // Making public or private replaces the button that was pressed, and a busy button
    // is disabled: either way focus falls back to the page or the dialog itself. Hand it
    // to the first control of the state the section is now in, so it stays visible.
    // Not on open: the dialog's first control takes focus then.
    const controlsRef = useRef<HTMLDivElement>(null);
    const hasOpened = useRef(false);
    useEffect(() => {
        if (!hasOpened.current) {
            hasOpened.current = true;
            return;
        }
        if (isMakingPublic || isMakingPrivate) return;
        const active = document.activeElement;
        if (active !== document.body && active?.getAttribute('role') !== 'dialog') return;
        controlsRef.current?.querySelector<HTMLElement>('input, button:enabled')?.focus();
    }, [isPublic, isMakingPublic, isMakingPrivate]);

    // Clicking Make Note Public with private linked notes asks about them first.
    const showLinksStep = askingAboutLinks && privateLinks.length > 0;
    const makePublic = (withLinks = false) => {
        setAskingAboutLinks(false);
        onMakePublic(withLinks ? privateLinks.map((n) => n.docId) : []);
    };

    const handleMakePrivate = async () => {
        if (await makePrivate()) setCopied(false);
    };

    // The card fields ride on the note's metadata, so a normal push publishes them.
    // Push this note directly: a full sync() is debounced and skipped while another runs.
    const saveShareCard = async (patch: ShareCardPatch) => {
        try {
            await setShareCard.mutateAsync({ docId: noteId, ...patch });
            void syncNote(noteId);
        } catch (err) {
            console.error('Failed to save link preview:', err);
            toast.error('Failed to save link preview');
        }
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy link:', err);
        }
    };

    return (
        <section aria-labelledby="share-general-heading" className="flex min-w-0 flex-col gap-3">
            <h3 id="share-general-heading" className="text-sm leading-5 font-medium">
                General access
            </h3>
            <p className="flex items-center gap-2 text-sm">
                {isPublic ? <Globe className="size-4 shrink-0" aria-hidden /> : <Lock className="size-4 shrink-0" aria-hidden />}
                {isPublic ? 'Anyone with the link can view' : 'Restricted (only people with access)'}
            </p>

            <div ref={controlsRef} className="flex min-w-0 flex-col gap-6">
                {!isPublic ? (
                    <div className="flex flex-col gap-4">
                        <Notice icon={Eye}>
                            Making this note public will allow anyone with the link to view it.
                        </Notice>

                        {showLinksStep ? (
                            <div className="flex flex-col gap-3" role="group" aria-labelledby="share-links-heading">
                                <Notice id="share-links-heading" icon={Link2}>
                                    This note links to {privateLinks.length} private {privateLinks.length === 1 ? 'note' : 'notes'}. Readers won't be able to open {privateLinks.length === 1 ? 'it' : 'them'}.
                                </Notice>
                                <ul className="flex flex-col gap-1 text-sm">
                                    {privateLinks.map((n) => (
                                        <li key={n.docId} className="flex items-center gap-2">
                                            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{n.title || 'Untitled'}</span>
                                        </li>
                                    ))}
                                </ul>
                                <Button size="lg" className="w-full max-sm:h-11" onClick={() => makePublic(true)} disabled={isMakingPublic}>
                                    <Globe />
                                    Make these public too
                                </Button>
                                <Button size="lg" variant="outline" className="w-full max-sm:h-11" onClick={() => makePublic()} disabled={isMakingPublic}>
                                    Continue anyway
                                </Button>
                            </div>
                        ) : (
                            <Button
                                size="lg"
                                className="w-full max-sm:h-11"
                                onClick={() => (privateLinks.length > 0 ? setAskingAboutLinks(true) : makePublic())}
                                disabled={isMakingPublic}
                            >
                                {isMakingPublic ? (
                                    <>
                                        <Loader2 className="animate-spin" />
                                        Making public…
                                    </>
                                ) : (
                                    <>
                                        <Globe />
                                        Make Note Public
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col gap-3">
                            <Notice id="share-link-notice" icon={Globe}>
                                This note is now public. Anyone with the link below can view it.
                            </Notice>

                            <div className="flex items-center gap-2">
                                <Input
                                    readOnly
                                    value={shareUrl}
                                    aria-label="Public link"
                                    aria-describedby="share-link-notice"
                                    className="min-w-0 flex-1 bg-muted/40 text-sm max-sm:h-11 dark:bg-muted/40"
                                />
                                <Button
                                    variant="outline"
                                    className="min-w-28 shrink-0 max-sm:h-11"
                                    onClick={handleCopyLink}
                                    disabled={isMakingPrivate}
                                >
                                    {copied ? (
                                        <>
                                            <Check className="text-green-700 dark:text-green-400" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy />
                                            Copy link
                                        </>
                                    )}
                                </Button>
                            </div>
                            <span aria-live="polite" className="sr-only">
                                {copied ? 'Link copied' : ''}
                            </span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label htmlFor="share-description" className="leading-5">Description</Label>
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-muted-foreground hover:text-foreground"
                                    disabled={!shareDescription || isMakingPrivate}
                                    onClick={() => saveShareCard({ shareDescription: '' })}
                                >
                                    Use first paragraph
                                </Button>
                            </div>
                            {/* Uncontrolled and keyed on the saved value: typing doesn't
                                re-render the dialog, and a reset/remote change reloads it. */}
                            <Textarea
                                key={shareDescription}
                                id="share-description"
                                defaultValue={shareDescription}
                                placeholder={cardPreview.defaultDescription}
                                maxLength={300}
                                disabled={isMakingPrivate}
                                className="min-h-24 leading-relaxed"
                                onBlur={(e) => {
                                    if (e.target.value.trim() !== shareDescription) {
                                        void saveShareCard({ shareDescription: e.target.value });
                                    }
                                }}
                            />
                        </div>

                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 space-y-1">
                                <Label htmlFor="share-listed" className="leading-5">
                                    Show on my public page
                                </Label>
                                <p id="share-listed-help" className="text-xs leading-relaxed text-muted-foreground">
                                    Off keeps the note public by link only, off your author page and folder page.
                                </p>
                            </div>
                            <Switch
                                id="share-listed"
                                aria-describedby="share-listed-help"
                                className="mt-0.5"
                                checked={!unlisted}
                                disabled={isMakingPrivate}
                                onCheckedChange={(listed) => saveShareCard({ shareUnlisted: !listed })}
                            />
                        </div>

                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 space-y-1">
                                <Label htmlFor="share-indexable" className="leading-5">
                                    Hide from search engines
                                </Label>
                                <p id="share-indexable-help" className="text-xs leading-relaxed text-muted-foreground">
                                    Link previews work either way. An unlisted note is always hidden from search engines.
                                </p>
                            </div>
                            <Switch
                                id="share-indexable"
                                aria-describedby="share-indexable-help"
                                className="mt-0.5"
                                checked={unlisted || !metadata?.shareIndexable}
                                disabled={isMakingPrivate || unlisted}
                                onCheckedChange={(hide) => saveShareCard({ shareIndexable: !hide })}
                            />
                        </div>

                        {/* The safe action first; stopping sharing sits apart, below a rule. */}
                        <div className="flex flex-col gap-3">
                            <Button
                                variant="outline"
                                className="w-full justify-start max-sm:h-11"
                                disabled={isMakingPrivate}
                                onClick={() => window.open(shareUrl, '_blank')}
                            >
                                <ExternalLink />
                                Open in New Tab
                            </Button>

                            <div className="border-t pt-3">
                                <Button
                                    variant="ghost"
                                    className="w-full justify-start text-red-700 hover:bg-red-500/10 hover:text-red-700 max-sm:h-11 dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-400"
                                    onClick={handleMakePrivate}
                                    disabled={isMakingPrivate}
                                >
                                    {isMakingPrivate ? (
                                        <>
                                            <Loader2 className="animate-spin" />
                                            Stopping…
                                        </>
                                    ) : (
                                        <>
                                            <Lock />
                                            Stop sharing (make private)
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
