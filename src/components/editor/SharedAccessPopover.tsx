import { Users, ChevronDown, UserPlus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useCircles } from '@/hooks/circles/useCircles';
import { AccessRow, CircleIcon, PersonAvatar, PersonLabel } from '@/components/share/SharePeopleSection';
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
                    className="share-ui flex cursor-pointer items-center gap-1 rounded-full bg-collaborative/10 px-2 py-0.5 text-xs font-medium text-collaborative outline-none transition-colors hover:bg-collaborative/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <Users className="size-3" aria-hidden />
                    <span>Shared</span>
                    <ChevronDown className="size-3" aria-hidden />
                </button>
            </PopoverTrigger>
            {/* The same rows as the Share dialog, with the role as text: changes happen there, through Manage… */}
            <PopoverContent align="end" className="share-ui flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-4">
                <h3 className="text-sm leading-5 font-medium">People with access</h3>

                <ul aria-label="People with access" className="flex max-h-80 min-w-0 flex-col overflow-y-auto overscroll-contain">
                    {circles.map(({ id, role }) => (
                        <AccessRow
                            key={`circle:${id}`}
                            icon={<CircleIcon />}
                            label={<span className="block truncate text-sm font-medium">{circleName(id) ?? (circlesFetch.isLoading ? 'Loading…' : 'Circle')}</span>}
                        >
                            <span className="shrink-0 text-sm text-muted-foreground">{role}</span>
                        </AccessRow>
                    ))}
                    {[...people].map(([odinId, role]) => (
                        <AccessRow key={`person:${odinId}`} icon={<PersonAvatar odinId={odinId} />} label={<PersonLabel odinId={odinId} />}>
                            <span className="shrink-0 text-sm text-muted-foreground">{role}</span>
                        </AccessRow>
                    ))}
                </ul>

                {lastEditedBy && (
                    <p className="border-t pt-3 text-xs text-muted-foreground">
                        Last edited by{' '}
                        <span title={lastEditedBy} className="text-foreground">
                            {agentDisplayName(lastEditedBy) ?? lastEditedBy.split('.')[0]}
                        </span>
                        {formattedTime && (
                            <span className="ml-1">{formattedTime}</span>
                        )}
                    </p>
                )}

                {isOwner && (
                    <Button variant="outline" className="mt-1 w-full max-sm:h-11" onClick={manage}>
                        <UserPlus aria-hidden />
                        Manage…
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    );
}
