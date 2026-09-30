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
 * A public note is stored Anonymous (+ unencrypted); a collaborative note is shared
 * with its circles; everything else stays Owner-only.
 */
export function noteAcl(
    metadata: Pick<DocumentMetadata, 'isPublic' | 'isCollaborative' | 'circleIds'>
): AccessControlList {
    if (metadata.isPublic) {
        return { requiredSecurityGroup: SecurityGroupType.Anonymous };
    }
    if (metadata.isCollaborative && metadata.circleIds?.length) {
        return {
            requiredSecurityGroup: SecurityGroupType.Connected,
            circleIdList: metadata.circleIds,
        };
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
