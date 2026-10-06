import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, ExternalLink, AlertTriangle, Check, Loader2, Globe, Lock } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShareCardPreview } from '@/components/share/ShareCardPreview';
import { OdinImage } from '@/components/OdinImage/OdinImage';
import { useAuth } from '@/hooks/auth';
import { useDotYouClientContext } from '@/components/auth';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';
import { useNotes } from '@/hooks/useNotes';
import { useSyncService } from '@/hooks/useSyncService';
import { useShareCardPreview } from '@/hooks/useShareCardPreview';
import * as Y from 'yjs';
import { getDocumentUpdates, getSyncRecord } from '@/lib/db';
import { buildPublicCard, type ShareCardPatch } from '@/lib/share/publicCard';
import { toast } from 'sonner';

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
            const rekeyed = await provider.makeNotePublic(noteId, record?.remoteFileId, buildPublicCard(blob, metadata ?? {}));
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

    // Only an uploaded cover reaches the link card; a pending one previews as the logo.
    const coverSrc = cardPreview.cover?.src;
    const [coverFileId, coverPayloadKey] = coverSrc?.startsWith('attachment://')
        ? coverSrc.replace('attachment://', '').split('/')
        : [];

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
        <div className="w-full max-w-[500px] space-y-3">
            <h5 className="text-sm font-medium">Link preview</h5>
            <ShareCardPreview
                title={noteTitle || 'Untitled'}
                description={cardPreview.description}
                domain={window.location.host}
                image={coverFileId ? (
                    <OdinImage
                        dotYouClient={dotYouClient}
                        targetDrive={JOURNAL_DRIVE}
                        fileId={coverFileId}
                        fileKey={coverPayloadKey}
                        alt=""
                        fit="cover"
                        className="h-full w-full"
                    />
                ) : undefined}
            />
        </div>
    );

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            {/* A full-screen sheet below sm, a wide dialog from sm. The fixed height lives on the
                inner wrapper, not here: DialogContent is a grid, so a child sized to its content
                would never scroll. The close button gets a 44px target on phones. */}
            <DialogContent className="gap-0 overflow-hidden p-0 max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0 sm:max-w-[min(960px,calc(100vw-2rem))] max-sm:[&>[data-slot=dialog-close]]:top-1.5 max-sm:[&>[data-slot=dialog-close]]:right-1.5 max-sm:[&>[data-slot=dialog-close]]:p-3.5">
                <div className="flex h-dvh min-w-0 flex-col sm:h-[min(640px,90dvh)]">
                    <DialogHeader className="shrink-0 border-b px-6 py-4 pr-14">
                        <DialogTitle>Share Note</DialogTitle>
                        <DialogDescription className="truncate">
                            Share "{noteTitle || 'Untitled'}" with a public link
                        </DialogDescription>
                    </DialogHeader>

                    {/* One scroll area below 880px; from 880px two columns that each scroll alone. */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden min-[880px]:flex-row min-[880px]:overflow-hidden">
                        {/* Controls (left from 880px). Below that the preview is stacked above them. */}
                        <div className="flex min-w-0 flex-col gap-4 p-6 min-[880px]:min-h-0 min-[880px]:flex-1 min-[880px]:overflow-y-auto">
                            {!isPublic ? (
                                <>
                                    <Alert variant="destructive">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertDescription>
                                            Making this note public will allow anyone with the link to view it.
                                        </AlertDescription>
                                    </Alert>

                                    <Button
                                        className="w-full"
                                        onClick={handleMakePublic}
                                        disabled={isMakingPublic}
                                    >
                                        {isMakingPublic ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Making public...
                                            </>
                                        ) : (
                                            <>
                                                <Globe className="mr-2 h-4 w-4" />
                                                Make Note Public
                                            </>
                                        )}
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Alert>
                                        <Globe className="h-4 w-4" />
                                        <AlertDescription>
                                            This note is now public. Anyone with the link below can view it.
                                        </AlertDescription>
                                    </Alert>

                                    <div className="flex items-center gap-2">
                                        <Input
                                            readOnly
                                            value={shareUrl}
                                            className="min-w-0 flex-1 text-xs"
                                        />
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            aria-label="Copy link"
                                            onClick={handleCopyLink}
                                        >
                                            {copied ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <Label htmlFor="share-description">Description</Label>
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="h-auto p-0"
                                                disabled={!shareDescription}
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
                                            onBlur={(e) => {
                                                if (e.target.value.trim() !== shareDescription) {
                                                    void saveShareCard({ shareDescription: e.target.value });
                                                }
                                            }}
                                        />
                                    </div>

                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <Label htmlFor="share-indexable">
                                                Allow search engines to index this page
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Link previews work either way.
                                            </p>
                                        </div>
                                        <Switch
                                            id="share-indexable"
                                            checked={!!noteMetadata?.shareIndexable}
                                            onCheckedChange={(checked) => saveShareCard({ shareIndexable: checked })}
                                        />
                                    </div>

                                    <div className="mt-auto space-y-2 pt-2">
                                        <Button
                                            variant="outline"
                                            className="w-full justify-start"
                                            onClick={() => window.open(shareUrl, '_blank')}
                                        >
                                            <ExternalLink className="mr-2 h-4 w-4" />
                                            Open in New Tab
                                        </Button>

                                        <Button
                                            variant="outline"
                                            className="w-full justify-start text-destructive hover:text-destructive"
                                            onClick={handleMakePrivate}
                                            disabled={isMakingPrivate}
                                        >
                                            {isMakingPrivate ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Stopping…
                                                </>
                                            ) : (
                                                <>
                                                    <Lock className="mr-2 h-4 w-4" />
                                                    Stop sharing (make private)
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Preview: above the controls below 880px, a right column from 880px. */}
                        <div className="order-first flex min-w-0 shrink-0 flex-col p-6 pb-0 min-[880px]:order-last min-[880px]:w-[548px] min-[880px]:overflow-y-auto min-[880px]:border-l min-[880px]:bg-muted/30 min-[880px]:pb-6">
                            {previewSection}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
