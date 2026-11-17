import { useRef } from 'react';
import { Loader2, Newspaper, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/share/ShareGeneralAccess';
import { FEED_PERMISSION_MESSAGE, usePublishToFeed } from '@/hooks/usePublishToFeed';

/** Publish to feed (#1074): the note as a post on the owner's Homebase feed. Needs no public link. */
export function ShareToFeed({ noteId }: { noteId: string }) {
    const feed = usePublishToFeed(noteId);
    const summaryRef = useRef<HTMLTextAreaElement>(null);
    return (
        <section aria-labelledby="share-feed-heading" className="flex min-w-0 flex-col gap-3">
            <h3 id="share-feed-heading" className="text-sm leading-5 font-medium">
                Feed
            </h3>
            <p id="share-feed-help" className="text-xs leading-relaxed text-muted-foreground">
                {feed.isPublished
                    ? 'This note is a post on your Homebase feed. Update it to publish your latest changes.'
                    : 'Post this note on your Homebase feed, where your followers see it.'}
            </p>
            <div className="flex flex-col gap-2">
                <Label htmlFor="share-feed-summary" className="leading-5">Summary</Label>
                {/* Uncontrolled and keyed on the saved value, as the link card's Description */}
                <Textarea
                    ref={summaryRef}
                    key={feed.summary}
                    id="share-feed-summary"
                    defaultValue={feed.summary}
                    aria-describedby="share-feed-summary-help"
                    disabled={feed.isPublishing}
                    className="min-h-20 leading-relaxed"
                    onBlur={(e) => void feed.saveSummary(e.target.value)}
                />
                <p id="share-feed-summary-help" className="text-xs leading-relaxed text-muted-foreground">
                    Optional. One to three sentences, about 300 characters, shown with the post on your feed.
                </p>
            </div>
            {feed.permissionDeclined && <Notice icon={ShieldAlert}>{FEED_PERMISSION_MESSAGE}</Notice>}
            <Button
                variant="outline"
                className="w-full max-sm:h-11"
                aria-describedby="share-feed-help"
                disabled={!feed.canPublish}
                onClick={() => void feed.publish(summaryRef.current?.value ?? '')}
            >
                {feed.isPublishing ? (
                    <>
                        <Loader2 className="animate-spin" />
                        Publishing…
                    </>
                ) : (
                    <>
                        <Newspaper />
                        {feed.isPublished ? 'Update on feed' : 'Publish to feed'}
                    </>
                )}
            </Button>
        </section>
    );
}
