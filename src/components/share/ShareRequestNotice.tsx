import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClearShareRequest } from '@/hooks/useShareRequest';
import { describeRequest } from '@/lib/share/shareRequest';
import type { NoteListEntry } from '@/types';

/**
 * Above the open note while an agent's share request waits (#325): Review opens the Share
 * dialog with the request loaded, Decline drops it. Nothing is shared from here.
 */
export function ShareRequestNotice({ note, onReview }: { note: NoteListEntry | undefined; onReview: (note: NoteListEntry) => void }) {
    const clearRequest = useClearShareRequest();
    const request = note?.metadata.shareRequest;
    if (!note || !request) return null;
    return (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/40 px-4 py-2 text-sm">
            <Share2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 text-pretty">{describeRequest(request)}</span>
            <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => void clearRequest(note.docId)}>
                    Decline
                </Button>
                <Button size="sm" className="max-sm:h-11" onClick={() => onReview(note)}>
                    Review
                </Button>
            </div>
        </div>
    );
}
