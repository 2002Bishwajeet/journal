import { describe, it, expect } from 'vitest';
import { describeRequest, requestDraft } from '@/lib/share/shareRequest';
import { noteShareUrl } from '@/lib/share/sharedFolder';
import { EMPTY_GRANTS, parseGrants, setFolderAccess } from '@/lib/agent/grants';
import type { ShareRequest } from '@/types';

const circles = [
    { id: 'c-family', name: 'Family', memberCount: 3 },
    { id: 'c-empty', name: 'Empty', memberCount: 0 },
    { id: 'c-off', name: 'Old', memberCount: 2, disabled: true },
];

const request = (overrides: Partial<ShareRequest>): ShareRequest => ({ access: 'people', by: 'agent:claude-code', at: 0, ...overrides });

describe('share request → Share dialog draft (#325)', () => {
    it('resolves circles by id, then by name ignoring case, and keeps people', () => {
        const draft = requestDraft(
            request({
                with: [
                    { kind: 'circle', id: 'c-family', role: 'viewer' },
                    { kind: 'circle', id: 'FAMILY', role: 'editor' },
                    { kind: 'person', id: 'friend.dotyou.cloud', role: 'viewer' },
                ],
            }),
            circles,
        );
        expect(draft).toEqual({
            entries: [
                { kind: 'circle', id: 'c-family', role: 'viewer' },
                { kind: 'circle', id: 'c-family', role: 'editor' },
                { kind: 'person', id: 'friend.dotyou.cloud', role: 'viewer' },
            ],
            refused: [],
        });
    });

    it('refuses an unknown, an empty and a disabled circle', () => {
        const draft = requestDraft(
            request({
                with: [
                    { kind: 'circle', id: 'Work', role: 'viewer' },
                    { kind: 'circle', id: 'empty', role: 'viewer' },
                    { kind: 'circle', id: 'c-off', role: 'viewer' },
                ],
            }),
            circles,
        );
        expect(draft.entries).toEqual([]);
        expect(draft.refused).toEqual(['No circle named “Work”', 'Empty: no members', 'Old: circle is disabled']);
    });

    it('describes what the agent asks for', () => {
        expect(describeRequest(request({ access: 'public' }))).toBe('Claude Code asks to make this note public.');
        expect(describeRequest(request({ access: 'private' }))).toBe('Claude Code asks to stop sharing this note.');
        expect(describeRequest(request({ with: [{ kind: 'person', id: 'a.dotyou.cloud', role: 'viewer' }, { kind: 'circle', id: 'Family', role: 'viewer' }] })))
            .toBe('Claude Code asks to share this note with a.dotyou.cloud, Family.');
    });
});

describe('noteShareUrl', () => {
    it('is the URL the Share dialog copied before', () => {
        const identity = 'me.dotyou.cloud';
        expect(noteShareUrl('https://journal.cloudx.run', identity, 'n1')).toBe(`https://journal.cloudx.run/share/${encodeURIComponent(identity)}/n1`);
    });
});

describe('allowShareRequests grant', () => {
    it('parseGrants keeps true, defaults to off, and drops anything else', () => {
        const base = { version: 1, folders: {}, notes: {} };
        expect(parseGrants({ ...base, allowShareRequests: true }).allowShareRequests).toBe(true);
        expect(parseGrants(base)).not.toHaveProperty('allowShareRequests');
        expect(parseGrants({ ...base, allowShareRequests: 'yes' })).not.toHaveProperty('allowShareRequests');
        expect(EMPTY_GRANTS).not.toHaveProperty('allowShareRequests');
    });

    it('a folder grant (as the MCP grantFolder saves it) keeps the switch', () => {
        expect(setFolderAccess({ ...EMPTY_GRANTS, allowShareRequests: true }, 'f', 'write')).toMatchObject({
            allowShareRequests: true,
            folders: { f: 'write' },
        });
    });
});
