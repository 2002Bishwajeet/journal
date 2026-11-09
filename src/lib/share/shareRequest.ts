import { agentDisplayName } from '@/lib/agent/attribution';
import { circleDisabledReason, type AccessEntry, type ShareCircle } from '@/lib/share/shareAccess';
import type { ShareRequest } from '@/types';

/**
 * An agent's share_note request (#325) as the Share dialog's draft: circles resolved by id,
 * then by name ignoring case, against the owner's circles. A circle that isn't found, is
 * disabled or has no members is left out and named in `refused`, as the dialog's search would.
 */
export function requestDraft(
    request: ShareRequest,
    circles: ShareCircle[],
): { entries: AccessEntry[]; refused: string[] } {
    const entries: AccessEntry[] = [];
    const refused: string[] = [];
    for (const entry of request.with ?? []) {
        if (entry.kind === 'person') {
            entries.push(entry);
            continue;
        }
        const circle = circles.find((c) => c.id === entry.id)
            ?? circles.find((c) => c.name.toLowerCase() === entry.id.toLowerCase());
        const reason = circle && circleDisabledReason(circle);
        if (!circle) refused.push(`No circle named “${entry.id}”`);
        else if (reason) refused.push(`${circle.name}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`);
        else entries.push({ kind: 'circle', id: circle.id, role: entry.role });
    }
    return { entries, refused };
}

/** "Claude Code asks to make this note public", for the note's notice and the Share dialog. */
export function describeRequest(request: ShareRequest): string {
    const who = agentDisplayName(request.by) ?? 'An agent';
    if (request.access === 'public') return `${who} asks to make this note public.`;
    if (request.access === 'private') return `${who} asks to stop sharing this note.`;
    const names = (request.with ?? []).map((e) => e.id);
    return `${who} asks to share this note with ${names.join(', ')}.`;
}
