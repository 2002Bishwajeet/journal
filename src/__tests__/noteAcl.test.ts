import { describe, it, expect } from 'vitest';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import { noteAcl, sharedAcl } from '@/lib/homebase/noteUploadMetadata';

describe('noteAcl', () => {
    it('a public note is Anonymous (even if also marked collaborative)', () => {
        expect(noteAcl({ isPublic: true, isCollaborative: true, circleIds: ['c1'] }))
            .toEqual({ requiredSecurityGroup: SecurityGroupType.Anonymous });
    });

    it('a collaborative note with circles is Connected to those circles', () => {
        expect(noteAcl({ isCollaborative: true, circleIds: ['c1', 'c2'] })).toEqual({
            requiredSecurityGroup: SecurityGroupType.Connected,
            circleIdList: ['c1', 'c2'],
        });
    });

    it('a collaborative note with no circles is Owner-only', () => {
        expect(noteAcl({ isCollaborative: true, circleIds: [] }))
            .toEqual({ requiredSecurityGroup: SecurityGroupType.Owner });
    });

    // #897: a circle-only share uploads exactly what it did before people could be named
    it('a circle-only share has no odinIdList key, even with an empty odinIds', () => {
        const acl = noteAcl({ isCollaborative: true, circleIds: ['c1'], odinIds: [] });
        expect(acl).toStrictEqual({ requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['c1'] });
        expect(Object.keys(acl)).toEqual(['requiredSecurityGroup', 'circleIdList']);
    });

    it('a note shared with people only is Connected to those people', () => {
        expect(noteAcl({ isCollaborative: true, odinIds: ['sam.id'] })).toStrictEqual({
            requiredSecurityGroup: SecurityGroupType.Connected,
            odinIdList: ['sam.id'],
        });
    });

    it('a note shared with circles and people names both', () => {
        expect(noteAcl({ isCollaborative: true, circleIds: ['c1'], odinIds: ['sam.id'] })).toStrictEqual({
            requiredSecurityGroup: SecurityGroupType.Connected,
            circleIdList: ['c1'],
            odinIdList: ['sam.id'],
        });
    });

    it('a collaborative note naming no circle and no person is Owner-only', () => {
        expect(noteAcl({ isCollaborative: true, circleIds: [], odinIds: [] }))
            .toEqual({ requiredSecurityGroup: SecurityGroupType.Owner });
    });

    it('a public note is Anonymous even when it names people', () => {
        expect(noteAcl({ isPublic: true, isCollaborative: true, odinIds: ['sam.id'] }))
            .toEqual({ requiredSecurityGroup: SecurityGroupType.Anonymous });
    });

    it('a private note is Owner-only', () => {
        expect(noteAcl({})).toEqual({ requiredSecurityGroup: SecurityGroupType.Owner });
    });
});

describe('sharedAcl', () => {
    // Connected with nothing named would admit every connection
    it('refuses to name no one', () => {
        expect(() => sharedAcl({ circleIds: [], odinIds: [] })).toThrow();
    });
});
