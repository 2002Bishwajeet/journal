import { useState, useEffect, useCallback } from 'react';
import { Copy, Download, ExternalLink, AlertTriangle, Check, Loader2, Globe } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/auth';
import { useDotYouClientContext } from '@/components/auth';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { extractMarkdownFromYjs } from '@/lib/utils';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
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
    
    const [copied, setCopied] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isPublic, setIsPublic] = useState(false);
    const [isMakingPublic, setIsMakingPublic] = useState(false);

    const identity = getIdentity() || 'unknown';
    const shareUrl = `${window.location.origin}/share/${encodeURIComponent(identity)}/${noteId}`;

    const checkPublicStatus = useCallback(async () => {
        if (!dotYouClient || !isOpen) return;

        try {
            const provider = new NotesDriveProvider(dotYouClient);
            const note = await provider.getNote(noteId);
            
            if (note?.serverMetadata?.accessControlList?.requiredSecurityGroup === SecurityGroupType.Anonymous) {
                setIsPublic(true);
            }
        } catch (err) {
            console.error('Failed to check public status:', err);
        }
    }, [dotYouClient, isOpen, noteId]);

    // Check status when dialog opens
    useEffect(() => {
        if (isOpen) {
            checkPublicStatus();
        } else {
            setIsPublic(false);
            setCopied(false);
        }
    }, [isOpen, checkPublicStatus]);

    const handleMakePublic = useCallback(async () => {
        if (!dotYouClient) {
            toast.error('Not authenticated');
            return;
        }

        setIsMakingPublic(true);
        try {
            const provider = new NotesDriveProvider(dotYouClient);
            await provider.makeNotePublic(noteId);
            setIsPublic(true);
            toast.success('Note is now publicly accessible');
        } catch (err) {
            console.error('Failed to make note public:', err);
            toast.error('Failed to make note public');
        } finally {
            setIsMakingPublic(false);
        }
    }, [dotYouClient, noteId]);

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
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
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
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
                                        onClick={handleCopyLink}
                                    >
                                        {copied ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>

                                <Button
                                    variant="outline"
                                    className="w-full justify-start"
                                    onClick={() => window.open(shareUrl, '_blank')}
                                >
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Open in New Tab
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
