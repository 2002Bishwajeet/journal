import { Users, ChevronDown } from 'lucide-react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useCircles } from '@/hooks/circles/useCircles';
import { AuthorImage } from '@/components/author/AuthorImage';

interface CollaborativePopoverProps {
    circleIds?: string[];
    recipients?: string[];
    lastEditedBy?: string;
}

export function CollaborativePopover({
    circleIds,
    recipients,
    lastEditedBy,
}: CollaborativePopoverProps) {
    const { fetch: circlesFetch } = useCircles(true);
    const circles = circlesFetch.data || [];

    const circleIdSet = new Set(circleIds);
    const matchedCircles = circles.filter(
        c => c.id && circleIdSet.has(c.id)
    );

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-collaborative/10 text-collaborative text-xs hover:bg-collaborative/20 transition-colors cursor-pointer">
                    <Users className="h-3 w-3" />
                    <span>Collaborative</span>
                    <ChevronDown className="h-3 w-3" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                    Shared with
                </div>

                {matchedCircles.length > 0 ? (
                    <div className="space-y-3">
                        {matchedCircles.map(circle => (
                            <div key={circle.id}>
                                <div className="text-sm font-medium mb-1.5">
                                    {circle.name}
                                </div>
                                {recipients && recipients.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {recipients.map(odinId => (
                                            <div
                                                key={odinId}
                                                className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded-full"
                                            >
                                                <AuthorImage
                                                    odinId={odinId}
                                                    className="h-4 w-4 rounded-full"
                                                />
                                                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                                                    {odinId.split('.')[0]}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">
                        {circleIds?.length
                            ? 'Unknown circle'
                            : 'Shared with your circles'}
                    </div>
                )}

                {lastEditedBy && (
                    <div className="border-t mt-3 pt-2 text-xs text-muted-foreground">
                        Last edited by{' '}
                        <span className="text-foreground">
                            {lastEditedBy.split('.')[0]}
                        </span>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
