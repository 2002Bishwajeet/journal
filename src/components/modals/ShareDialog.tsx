import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Download, ExternalLink, AlertTriangle, Check, Loader2, Globe, Lock } from 'lucide-react';
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
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';
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
    const { sync } = useSyncService();
    const cardPreview = useShareCardPreview(noteId);
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const [copied, setCopied] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
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
            const record = await getSyncRecord(noteId);
            const updates = await getDocumentUpdates(noteId);
            const blob = updates.length > 0 ? Y.mergeUpdates(updates) : undefined;
            const metadata = get.data?.find((n) => n.docId === noteId)?.metadata;
            await provider.makeNotePublic(noteId, record?.remoteFileId, buildPublicCard(blob, metadata ?? {}));
            setNotePublic.mutate({ docId: noteId, isPublic: true });
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
            await provider.makeNotePrivate(noteId, record?.remoteFileId);
            setCopied(false);
            setNotePublic.mutate({ docId: noteId, isPublic: false });
            toast.success('Sharing stopped — this note is private again');
        } catch (err) {
            console.error('Failed to make note private:', err);
            toast.error('Failed to stop sharing');
        } finally {
            setIsMakingPrivate(false);
        }
    };

    // The card fields ride on the note's metadata, so a normal push publishes them.
    const saveShareCard = async (patch: ShareCardPatch) => {
        try {
            await setShareCard.mutateAsync({ docId: noteId, ...patch });
            sync().catch((err) => console.error('[ShareDialog] Sync after link preview edit failed:', err));
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

    const handleExportMarkdown = async () => {
        setIsExporting(true);
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
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Share Note</DialogTitle>
                    <DialogDescription>
                        Export or share "{noteTitle || 'Untitled'}"
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Export Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-medium">Export</h4>
                        <Button
                            variant="outline"
                            className="w-full justify-start"
                            onClick={handleExportMarkdown}
                            disabled={isExporting}
                        >
                            <Download className="mr-2 h-4 w-4" />
                            {isExporting ? 'Exporting...' : 'Export to Markdown'}
                        </Button>
                    </div>

                    {/* Share Link Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-medium">Share via Link</h4>
                        
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
                                        className="flex-1 text-xs"
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

                                <div className="space-y-3">
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
                                </div>

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
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
