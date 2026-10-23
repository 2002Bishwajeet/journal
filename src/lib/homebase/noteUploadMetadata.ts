import {
    SecurityGroupType,
    type AccessControlList,
    type UploadAppFileMetaData,
} from '@homebase-id/js-lib/core';
import { toGuidId } from '@homebase-id/js-lib/helpers';
import { JOURNAL_FILE_TYPE, JOURNAL_DATA_TYPE } from './config';
import type { NoteFileContent, DocumentMetadata } from '@/types';

/**
 * The note's real created time, for appData.userDate.
 * Pushing Date.now() here would collapse every note's created date to its last push
 * time whenever the local DB is wiped and rebuilt from the server (SyncService reads
 * userDate back into timestamps.created for a note it doesn't have locally).
 * Safe for incremental sync: the cursor is ordered by 'anyChangeDate', not userDate.
 */
const createdUserDate = (metadata: DocumentMetadata): number => {
    const created = metadata.timestamps?.created;
    const parsed = created ? new Date(created).getTime() : NaN;
    return Number.isNaN(parsed) ? Date.now() : parsed;
};

/**
 * The ACL of a shared note, and of its invite: Connected, narrowed to the named circles
 * and identities. A list is sent only when it has entries, so a circle-only share uploads
 * exactly what it did before identities could be named (#681). With nothing named the ACL
 * would admit every connection, so that is refused.
 */
export function sharedAcl({ circleIds = [], odinIds = [] }: { circleIds?: string[]; odinIds?: string[] }): AccessControlList {
    if (circleIds.length === 0 && odinIds.length === 0) {
        throw new Error('A shared note must name at least one circle or identity');
    }
    return {
        requiredSecurityGroup: SecurityGroupType.Connected,
        ...(circleIds.length > 0 && { circleIdList: circleIds }),
        ...(odinIds.length > 0 && { odinIdList: odinIds }),
    };
}

/**
 * A public note is stored Anonymous (+ unencrypted); a collaborative note is shared
 * with its circles and identities; everything else stays Owner-only.
 */
export function noteAcl(
    metadata: Pick<DocumentMetadata, 'isPublic' | 'isCollaborative' | 'circleIds' | 'odinIds'>
): AccessControlList {
    if (metadata.isPublic) {
        return { requiredSecurityGroup: SecurityGroupType.Anonymous };
    }
    if (metadata.isCollaborative && (metadata.circleIds?.length || metadata.odinIds?.length)) {
        return sharedAcl({ circleIds: metadata.circleIds, odinIds: metadata.odinIds });
    }
    return { requiredSecurityGroup: SecurityGroupType.Owner };
}

/** The note's header content (without the collaboration fields). */
export function noteFileContent(metadata: DocumentMetadata): NoteFileContent {
    return {
        title: metadata.title,
        tags: metadata?.tags || [],
        excludeFromAI: metadata.excludeFromAI,
        isPinned: metadata.isPinned,
        isPublic: metadata.isPublic,
        shareDescription: metadata.shareDescription,
        shareIndexable: metadata.shareIndexable,
        shareUnlisted: metadata.shareUnlisted,
    };
}

export function noteAppData(
    uniqueId: string,
    metadata: DocumentMetadata,
    content: string
): UploadAppFileMetaData {
    return {
        uniqueId,
        groupId: metadata.folderId, // Group by folder for easy querying
        fileType: JOURNAL_FILE_TYPE,
        dataType: JOURNAL_DATA_TYPE,
        userDate: createdUserDate(metadata),
        tags: (metadata.tags || []).map(tag => toGuidId(tag)),
        content,
        archivalStatus: metadata.archivalStatus ?? 0,
    };
}
