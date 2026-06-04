import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PeerNoteContentStatus } from '@/hooks/usePeerNoteContent';

const MESSAGES: Partial<Record<PeerNoteContentStatus, string>> = {
    offline: "Can't reach the author to load this shared note. They may be offline.",
    forbidden: 'You no longer have access to this note.',
    notfound: 'This note no longer exists.',
    error: 'Something went wrong loading this shared note.',
};

export function isPeerContentFailure(status: PeerNoteContentStatus): boolean {
    return status in MESSAGES;
}

const READY_STATUSES: PeerNoteContentStatus[] = ['local', 'fetched', 'empty'];

export function isPeerContentReady(status: PeerNoteContentStatus): boolean {
    return READY_STATUSES.includes(status);
}

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
            <p className="text-sm font-medium">{MESSAGES[status] ?? MESSAGES.error}</p>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
                <Button variant="ghost" size="sm" onClick={onBack}>Back to list</Button>
            </div>
        </div>
    );
}
