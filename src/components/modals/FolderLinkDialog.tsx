import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/auth';
import { folderShareUrl } from '@/lib/share/sharedFolder';

interface FolderLinkDialogProps {
    folder: { id: string; name: string } | null;
    onClose: () => void;
}

/** The public link of a shared folder (#619), with copy and open buttons. */
export default function FolderLinkDialog({ folder, onClose }: FolderLinkDialogProps) {
    const { getIdentity } = useAuth();
    const url = folder ? folderShareUrl(window.location.origin, getIdentity() || 'unknown', folder.id) : '';

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copied');
        } catch (err) {
            console.error('Failed to copy folder link:', err);
            toast.error('Failed to copy link');
        }
    };

    return (
        <Dialog open={!!folder} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Folder link</DialogTitle>
                    <DialogDescription>
                        Anyone with this link can see the public notes in {folder?.name}.
                    </DialogDescription>
                </DialogHeader>
                <Input readOnly value={url} aria-label="Folder link" className="min-w-0 bg-muted/40 text-sm max-sm:h-11" />
                <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 max-sm:h-11" onClick={copy}>
                        <Copy />
                        Copy link
                    </Button>
                    <Button variant="outline" className="flex-1 max-sm:h-11" onClick={() => window.open(url, '_blank')}>
                        <ExternalLink />
                        Open in New Tab
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
