import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PeerNoteContentStatus } from '@/hooks/usePeerNoteContent';
import { PEER_NOTE_MESSAGES } from './peerNoteStatus';

export function PeerNoteLoading() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-sm">Loading shared note…</p>
        </div>
    );
}

export function PeerNoteError({
    status,
    onRetry,
    onBack,
}: {
    status: PeerNoteContentStatus;
    onRetry: () => void;
    onBack: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 px-6 text-center">
            <p className="text-sm font-medium">{PEER_NOTE_MESSAGES[status] ?? PEER_NOTE_MESSAGES.error}</p>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
                <Button variant="ghost" size="sm" onClick={onBack}>Back to list</Button>
            </div>
        </div>
    );
}
