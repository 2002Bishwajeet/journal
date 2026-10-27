import { Users, ChevronDown } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useCircles } from '@/hooks/circles/useCircles';
import { AuthorImage } from '@/components/author/AuthorImage';
import { formatRelativeTime } from '@/lib/utils';
import { agentDisplayName } from '@/lib/agent/attribution';
import type { DocumentMetadata } from '@/types';

type Role = 'Owner' | 'Editor' | 'Viewer';

interface SharedAccessPopoverProps {
    noteId: string;
    metadata: DocumentMetadata;
    /** The host owns the note: circles show by name, and Manage… opens the Share dialog. */
    isOwner: boolean;
    owner: string;
}

/**
 * Who can open a shared note, and their role (#682). On the owner's device: the circles by
 * name and the people named on the share. A receiver can't read the owner's circles, so
 * they see the owner and everyone the note names, each once.
 */
export function SharedAccessPopover({ noteId, metadata, isOwner, owner }: SharedAccessPopoverProps) {
    const [, setSearchParams] = useSearchParams();
    const { fetch: circlesFetch } = useCircles(true);
    const circleName = (id: string) => circlesFetch.data?.find((c) => c.id === id)?.name;
    const circles = isOwner
        ? [
            ...(metadata.circleIds ?? []).map((id) => ({ id, role: 'Editor' as const })),
            ...(metadata.viewerCircleIds ?? []).map((id) => ({ id, role: 'Viewer' as const })),
        ]
        : [];

    // The owner lists the people they named; a receiver lists everyone, editors first
    const people = new Map<string, Role>();
    people.set(owner, 'Owner');
    if (!isOwner) for (const odinId of metadata.recipients ?? []) if (!people.has(odinId)) people.set(odinId, 'Editor');
    for (const odinId of [...(metadata.odinIds ?? []), ...(isOwner ? [] : metadata.viewerRecipients ?? [])]) {
        if (!people.has(odinId)) people.set(odinId, 'Viewer');
    }

    const lastEditedBy = metadata.lastEditedBy;
    const formattedTime = metadata.timestamps?.modified ? formatRelativeTime(metadata.timestamps.modified) : null;

    const manage = () => setSearchParams((params) => {
        params.set('action', 'collaborate');
        params.set('noteId', noteId);
        return params;
    });

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    aria-label="Show who can access this note"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-collaborative/10 text-collaborative text-xs hover:bg-collaborative/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <Users className="h-3 w-3" />
                    <span>Shared</span>
                    <ChevronDown className="h-3 w-3" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                    People with access
                </div>

                <ul aria-label="People with access" className="space-y-1.5">
                    {circles.map(({ id, role }) => (
                        <li key={`circle:${id}`} className="flex items-center gap-2 text-sm">
                            <Users className="h-4 w-4 shrink-0 text-collaborative" aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{circleName(id) ?? (circlesFetch.isLoading ? 'Loading…' : 'Circle')}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{role}</span>
                        </li>
                    ))}
                    {[...people].map(([odinId, role]) => (
                        <li key={`person:${odinId}`} className="flex items-center gap-2 text-sm">
                            <AuthorImage odinId={odinId} className="h-4 w-4 shrink-0 rounded-full" />
                            <span title={odinId} className="min-w-0 flex-1 truncate">{odinId}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{role}</span>
                        </li>
                    ))}
                </ul>

                {lastEditedBy && (
                    <div className="border-t mt-3 pt-2 text-xs text-muted-foreground">
                        Last edited by{' '}
                        <span title={lastEditedBy} className="text-foreground">
                            {agentDisplayName(lastEditedBy) ?? lastEditedBy.split('.')[0]}
                        </span>
                        {formattedTime && (
                            <span className="ml-1">{formattedTime}</span>
                        )}
                    </div>
                )}

                {isOwner && (
                    <Button variant="outline" size="sm" className="mt-3 w-full" onClick={manage}>
                        Manage…
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    );
}
