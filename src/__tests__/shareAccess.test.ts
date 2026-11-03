/** #682: the Share dialog's people and circles, as plain data. */
import { describe, it, expect } from 'vitest';
import {
    NOT_A_CONNECTION,
    accessFromMetadata,
    defaultRole,
    refusalFor,
    sameAccess,
    searchCandidates,
    targetsFromAccess,
    type AccessEntry,
} from '@/lib/share/shareAccess';

const OWNER = 'me.id';
const circles = [
    { id: 'c1', name: 'Friends', memberCount: 2 },
    { id: 'c2', name: 'Family', memberCount: 0 },
    { id: 'c3', name: 'Old friends', memberCount: 1, disabled: true },
];
const connections = ['sam.id', 'frodo.id', 'me.id', 'Fred.ID'];
const search = (query: string, entries: AccessEntry[] = [], peopleUnavailable?: string) =>
    searchCandidates({ query, circles, connections, entries, owner: OWNER, peopleUnavailable });

describe('accessFromMetadata', () => {
    it('lists editor circles, viewer circles and named people', () => {
        expect(accessFromMetadata({
            isCollaborative: true,
            circleIds: ['c1'],
            viewerCircleIds: ['c2'],
            odinIds: ['sam.id'],
        })).toEqual([
            { kind: 'circle', id: 'c1', role: 'editor' },
            { kind: 'circle', id: 'c2', role: 'viewer' },
            { kind: 'person', id: 'sam.id', role: 'viewer' },
        ]);
    });

    it('is empty for a note that is not shared', () => {
        expect(accessFromMetadata({ isCollaborative: false, circleIds: ['c1'] })).toEqual([]);
        expect(accessFromMetadata(undefined)).toEqual([]);
    });
});

describe('targetsFromAccess', () => {
    it('splits circles by role and keeps people as viewers', () => {
        const entries: AccessEntry[] = [
            { kind: 'circle', id: 'c1', role: 'editor' },
            { kind: 'circle', id: 'c2', role: 'viewer' },
            { kind: 'person', id: 'sam.id', role: 'viewer' },
        ];
        expect(targetsFromAccess(entries, (id) => `name-${id}`)).toEqual({
            circles: [{ circleId: 'c1', name: 'name-c1' }],
            viewerCircles: [{ circleId: 'c2', name: 'name-c2' }],
            odinIds: ['sam.id'],
        });
    });
});

describe('sameAccess', () => {
    const a: AccessEntry = { kind: 'circle', id: 'c1', role: 'editor' };
    const b: AccessEntry = { kind: 'person', id: 'sam.id', role: 'viewer' };

    it('ignores order', () => {
        expect(sameAccess([a, b], [b, a])).toBe(true);
    });

    it('sees a role change', () => {
        expect(sameAccess([a], [{ ...a, role: 'viewer' }])).toBe(false);
    });

    it('sees an added or removed entry', () => {
        expect(sameAccess([a], [a, b])).toBe(false);
        expect(sameAccess([a, b], [a])).toBe(false);
    });
});

describe('defaultRole', () => {
    it('is Editor for a circle and Viewer for a person', () => {
        expect(defaultRole('circle')).toBe('editor');
        expect(defaultRole('person')).toBe('viewer');
    });
});

describe('searchCandidates', () => {
    it('finds circles first, then connections, each alphabetical', () => {
        expect(search('fr').map((c) => c.label)).toEqual(['Friends', 'Old friends', 'fred.id', 'frodo.id']);
    });

    it('lists an empty or disabled circle with the reason it cannot be added', () => {
        expect(search('family')[0]).toMatchObject({ id: 'c2', disabledReason: 'No members' });
        expect(search('old')[0]).toMatchObject({ id: 'c3', disabledReason: 'Circle is disabled' });
        expect(search('friends')[0].disabledReason).toBeUndefined();
    });

    it('leaves out the owner and everyone already added', () => {
        const ids = search('.id', [{ kind: 'person', id: 'sam.id', role: 'viewer' }]).map((c) => c.id);

        expect(ids).toEqual(['fred.id', 'frodo.id']);
    });

    it('marks people unavailable, with the reason, on a server without person sharing', () => {
        expect(search('sam', [], 'too old')[0]).toMatchObject({ id: 'sam.id', disabledReason: 'too old' });
    });

    it('is empty until something is typed', () => {
        expect(search('  ')).toEqual([]);
    });
});

describe('refusalFor', () => {
    it('refuses a typed identity that is not a connection', () => {
        expect(refusalFor('stranger.example.com', [], OWNER, [])).toBe(NOT_A_CONNECTION);
    });

    it('refuses the owner and someone already added', () => {
        expect(refusalFor('ME.id', [], OWNER, [])).toBe("You can't share a note with yourself");
        expect(refusalFor('sam.id', [], OWNER, [{ kind: 'person', id: 'sam.id', role: 'viewer' }])).toBe('sam.id already has access');
    });

    it('says nothing while the text matches something or is not an identity', () => {
        expect(refusalFor('sam.id', search('sam.id'), OWNER, [])).toBeNull();
        expect(refusalFor('fri', [], OWNER, [])).toBeNull();
    });
});
