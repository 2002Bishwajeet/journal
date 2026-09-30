import { describe, it, expect } from 'vitest';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import { noteAcl } from '@/lib/homebase/noteUploadMetadata';

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

    it('a private note is Owner-only', () => {
        expect(noteAcl({})).toEqual({ requiredSecurityGroup: SecurityGroupType.Owner });
    });
});
