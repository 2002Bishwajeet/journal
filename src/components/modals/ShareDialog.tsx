import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { Copy, ExternalLink, Check, Eye, Loader2, Globe, Lock, type LucideIcon } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShareCardPreview } from '@/components/share/ShareCardPreview';
import { useAuth } from '@/hooks/auth';
import { useDotYouClientContext } from '@/components/auth';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import { useShareCardPreview } from '@/hooks/useShareCardPreview';
import { useShareCardImage } from '@/hooks/useShareCardImage';
import * as Y from 'yjs';
import { getDocumentUpdates, getSyncRecord } from '@/lib/db';
import { buildPublicCard, type ShareCardPatch } from '@/lib/share/publicCard';
import { toast } from 'sonner';

// Focus returns to the note row on close. The dialog opens from the row's context menu,
// which hands focus back to the row only as it finishes closing, sometimes after the
// dialog has opened. So track the element last focused outside menus and dialogs.
const isOutsideOverlays = (el: EventTarget | null): el is HTMLElement =>
    el instanceof HTMLElement && el !== document.body && !el.closest('[role="menu"], [role="dialog"]');
let lastFocusOutside = isOutsideOverlays(document.activeElement) ? document.activeElement : null;
document.addEventListener('focusin', (e) => {
    if (isOutsideOverlays(e.target)) lastFocusOutside = e.target;
});
document.addEventListener('focusout', (e) => {
    // Focus left for nowhere, so there is nothing to go back to.
    if (isOutsideOverlays(e.target) && !e.relatedTarget) lastFocusOutside = null;
});

interface ShareDialogProps {
    isOpen: boolean;
    onClose: () => void;
    noteId: string;
    noteTitle: string;
}
export default function ShareDialog({
    isOpen,
    onClose,
    noteId,
    noteTitle,
}: ShareDialogProps) {
    const { getIdentity } = useAuth();
    const dotYouClient = useDotYouClientContext();
    const { get, setNotePublic, setShareCard } = useNotes();
    const { syncNote } = useSyncService();
    const cardPreview = useShareCardPreview(noteId);
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const [copied, setCopied] = useState(false);
    const [isMakingPublic, setIsMakingPublic] = useState(false);
    const [isMakingPrivate, setIsMakingPrivate] = useState(false);

    // Derived from the cached note metadata (kept current by make-public/private),
    // so the dialog matches the list badge without an extra network fetch.
    const noteMetadata = get.data?.find((n) => n.docId === noteId)?.metadata;
    const isPublic = !!noteMetadata?.isPublic;
    const shareDescription = noteMetadata?.shareDescription ?? '';
    // The same 1200×630 image the link unfurls with (og:image).
    const cardImage = useShareCardImage(noteId, cardPreview.cardImageFrom, isPublic);

    const identity = getIdentity() || 'unknown';
    const shareUrl = `${window.location.origin}/share/${encodeURIComponent(identity)}/${noteId}`;

    // kept: passed to Radix Dialog's onOpenChange (third-party API)
    const handleOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setCopied(false);
            onClose();
        }
    }, [onClose]);

    useEffect(() => () => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    }, []);

    // Making public or private replaces the button that was pressed, and a busy button
    // is disabled: either way focus falls back to the page or the dialog itself. Hand it
    // to the first control of the state the dialog is now in, so it stays visible.
    const controlsRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (isMakingPublic || isMakingPrivate) return;
        const active = document.activeElement;
        if (active !== document.body && active?.getAttribute('role') !== 'dialog') return;
        controlsRef.current?.querySelector<HTMLElement>('input, button:enabled')?.focus();
    }, [isPublic, isMakingPublic, isMakingPrivate]);

    const handleMakePublic = async () => {
        if (!dotYouClient) {
            toast.error('Not authenticated');
            return;
        }

        setIsMakingPublic(true);
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            // Pass the synced fileId: a just-created note's uniqueId lookup can 404 (#293)
            let record = await getSyncRecord(noteId);
            // A note shared within its debounced save window isn't on the server yet: push it first.
            if (!record?.remoteFileId) {
                await syncNote(noteId);
                record = await getSyncRecord(noteId);
            }
            const updates = await getDocumentUpdates(noteId);
            const blob = updates.length > 0 ? Y.mergeUpdates(updates) : undefined;
            const metadata = get.data?.find((n) => n.docId === noteId)?.metadata;
            // New publishes are indexable unless the owner opts out; a stored value is kept as is.
            const publishIndexable = metadata?.shareIndexable ?? true;
            const rekeyed = await provider.makeNotePublic(
                noteId,
                record?.remoteFileId,
                buildPublicCard(blob, { ...metadata, shareIndexable: publishIndexable })
            );
            // Persist it so later pushes rebuild the card with the same flag.
            if (metadata?.shareIndexable === undefined) await setShareCard.mutateAsync({ docId: noteId, shareIndexable: true });
            setNotePublic.mutate({ docId: noteId, isPublic: true, rekeyed });
            toast.success('Note is now publicly accessible');
        } catch (err) {
            console.error('Failed to make note public:', err);
            toast.error('Failed to make note public');
        } finally {
            setIsMakingPublic(false);
        }
    };

    const handleMakePrivate = async () => {
        if (!dotYouClient) {
            toast.error('Not authenticated');
            return;
        }

        setIsMakingPrivate(true);
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            const record = await getSyncRecord(noteId);
            const rekeyed = await provider.makeNotePrivate(noteId, record?.remoteFileId);
            setCopied(false);
            setNotePublic.mutate({ docId: noteId, isPublic: false, rekeyed });
            toast.success('Sharing stopped — this note is private again');
        } catch (err) {
            console.error('Failed to make note private:', err);
            toast.error('Failed to stop sharing');
        } finally {
            setIsMakingPrivate(false);
        }
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

    const previewSection = (
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

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            {/* A full-screen sheet below sm, a wide dialog from sm. The fixed height lives on the
                inner wrapper, not here: DialogContent is a grid, so a child sized to its content
                would never scroll. The close button gets a 44px target on phones and sits level
                with the title. `share-dialog` scopes this dialog's token overrides (src/index.css). */}
            <DialogContent
                className="share-dialog gap-0 overflow-hidden p-0 max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0 sm:max-w-[min(960px,calc(100vw-2rem))] max-sm:[&>[data-slot=dialog-close]]:top-2 max-sm:[&>[data-slot=dialog-close]]:right-1.5 max-sm:[&>[data-slot=dialog-close]]:p-3.5 sm:[&>[data-slot=dialog-close]]:top-5.5"
                onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    lastFocusOutside?.focus();
                }}
            >
                <div className="flex h-dvh min-w-0 flex-col sm:h-[min(640px,90dvh)]">
                    <DialogHeader className="shrink-0 gap-1.5 border-b px-6 py-4 pr-14 text-left">
                        <div className="flex min-w-0 items-center gap-3">
                            <DialogTitle className="font-serif text-xl leading-7 font-normal tracking-tight">
                                Share Note
                            </DialogTitle>
                            {isPublic ? (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                                    <Globe className="size-3" />
                                    Public
                                </span>
                            ) : (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                    <Lock className="size-3" />
                                    Private
                                </span>
                            )}
                        </div>
                        <DialogDescription className="truncate">
                            Share “{noteTitle || 'Untitled'}” with a public link
                        </DialogDescription>
                    </DialogHeader>

                    {/* One scroll area below 880px; from 880px two columns that each scroll alone. */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain min-[880px]:flex-row min-[880px]:overflow-hidden">
                        {/* Controls (left from 880px). Below that the preview is stacked above them. */}
                        <section
                            ref={controlsRef}
                            aria-label="Sharing options"
                            className="flex min-w-0 flex-col gap-6 p-6 min-[880px]:min-h-0 min-[880px]:flex-1 min-[880px]:overflow-y-auto min-[880px]:overscroll-contain"
                        >
                            {!isPublic ? (
                                <div className="flex flex-col gap-4">
                                    <Notice icon={Eye}>
                                        Making this note public will allow anyone with the link to view it.
                                    </Notice>

                                    <Button
                                        size="lg"
                                        className="w-full max-sm:h-11"
                                        onClick={handleMakePublic}
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
                                            <Label htmlFor="share-indexable" className="leading-5">
                                                Hide from search engines
                                            </Label>
                                            <p id="share-indexable-help" className="text-xs leading-relaxed text-muted-foreground">
                                                Your author page lists it either way. Link previews work either way.
                                            </p>
                                        </div>
                                        <Switch
                                            id="share-indexable"
                                            aria-describedby="share-indexable-help"
                                            className="mt-0.5"
                                            checked={!noteMetadata?.shareIndexable}
                                            disabled={isMakingPrivate}
                                            onCheckedChange={(hide) => saveShareCard({ shareIndexable: !hide })}
                                        />
                                    </div>

                                    {/* The safe action first; stopping sharing sits apart, below a rule. */}
                                    <div className="mt-auto flex flex-col gap-3">
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
                        </section>

                        {/* Preview: above the controls below 880px, a right column from 880px. */}
                        <section
                            aria-labelledby="share-preview-heading"
                            className="order-first flex min-w-0 shrink-0 flex-col p-6 pb-0 min-[880px]:order-last min-[880px]:w-[548px] min-[880px]:overflow-y-auto min-[880px]:overscroll-contain min-[880px]:border-l min-[880px]:bg-muted/30 min-[880px]:pb-6"
                        >
                            {previewSection}
                        </section>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** A calm line saying what the current state means: information, not a warning. */
function Notice({ id, icon: Icon, children }: { id?: string; icon: LucideIcon; children: ReactNode }) {
    return (
        <p id={id} className="flex gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-pretty">
            <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span>{children}</span>
        </p>
    );
}
