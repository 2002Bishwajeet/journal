import * as Y from 'yjs';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { FolderDriveProvider } from '@/lib/homebase/FolderDriveProvider';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import { toMarkdown, type LinkTarget } from '@/lib/agent/editEngine';
import { buildPublicCard } from '@/lib/share/publicCard';
import { setFolderAccess, type AgentAccess } from '@/lib/agent/grants';
import { noteShareUrl } from '@/lib/share/sharedFolder';
import { getExtendAppRegistrationParams } from '@homebase-id/js-lib/auth';
import { getSecurityContext, type DotYouClient, type HomebaseFile } from '@homebase-id/js-lib/core';
import { drivesEqual, getUniqueDrivesWithHighestPermission, stringifyToQueryParams } from '@homebase-id/js-lib/helpers';
import { BlogConfig, getPostByGlobalTransitId } from '@homebase-id/js-lib/public';
import { hasEdits, type ImageEdits } from '@/lib/images/imageEdits';
import { sniffImageType, stripImageMetadata } from '@/lib/images/imageBytes';
import { FEED_DRIVE_REQUEST, publishNoteToFeed } from '@/lib/share/publishNoteToFeed';
import type { PreparedImage } from '@/lib/images/imageBytes';
import type { DocumentMetadata, NoteFileContent } from '@/types';
import type { NoteSummary } from '@/lib/agent/tools/read';
import { VersionConflictError, type NoteEdit, type NoteForEdit } from '@/lib/agent/tools/write';
import type { McpCredentials } from './credentials';
import { createClient } from './client';
import { JOURNAL_MCP_APP_ID, appOrigin } from './config';
import type { FeedDeps } from './feed';
import type { McpDriveDeps } from './createServer';

export function toNoteSummary(file: HomebaseFile<NoteFileContent>): NoteSummary | null {
    const uniqueId = file.fileMetadata.appData.uniqueId;
    const content = file.fileMetadata.appData.content;
    // A note in Trash (archivalStatus 2) is gone for agents, as for the app's lists.
    if (!uniqueId || !content || file.fileMetadata.appData.archivalStatus === 2) return null;

    return {
        id: uniqueId,
        title: content.title,
        folderId: file.fileMetadata.appData.groupId ?? '',
        tags: content.tags ?? [],
        modified: new Date(file.fileMetadata.updated).toISOString(),
        excludeFromAI: content.excludeFromAI,
    };
}

/**
 * Follows `cursor` until the drive returns an empty page, dropping null items. Homebase
 * never returns an empty cursor: past the last result it keeps returning an empty page
 * with the same cursor, so the empty page is the only end signal.
 */
export async function collectPages<T>(
    fetchPage: (cursor: string | undefined) => Promise<{ items: (T | null)[]; cursor: string }>
): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    do {
        const page = await fetchPage(cursor);
        if (page.items.length === 0) break;
        for (const item of page.items) if (item) all.push(item);
        cursor = page.cursor || undefined;
    } while (cursor);
    return all;
}

/** Strips an unedited image's metadata in place of the app's canvas redraw; an edited one can't be published here. */
export async function stripForFeed(image: Blob, edits: ImageEdits): Promise<Blob> {
    if (hasEdits(edits)) {
        throw new Error('publish_to_feed: the note has a cropped, rotated or flipped image, which only the Journal app can publish. Nothing was published.');
    }
    const bytes = new Uint8Array(await image.arrayBuffer());
    const type = sniffImageType(bytes);
    return type ? new Blob([new Uint8Array(stripImageMetadata(bytes, type))], { type }) : image;
}

/**
 * FeedDeps (mcp/feed.ts) on the app's publish code. Images are not redrawn (no canvas in Node):
 * their metadata is stripped, and a note with a cropped, rotated or flipped image is left for
 * the app to publish.
 */
export function createFeedDeps(client: DotYouClient, notesProvider: NotesDriveProvider, identity: string): FeedDeps {
    async function missingGrantUrl(): Promise<string | null> {
        // As useMissingPermissions: the highest grant on the drive covers what is asked for.
        const context = await getSecurityContext(client);
        const grants = getUniqueDrivesWithHighestPermission(context.permissionContext.permissionGroups.flatMap((g) => g.driveGrants));
        const asked = FEED_DRIVE_REQUEST.permissions.reduce((a, b) => a + b, 0);
        const granted = grants.some(
            (g) => drivesEqual(g.permissionedDrive.drive, FEED_DRIVE_REQUEST) && g.permissionedDrive.permission.reduce((a, b) => a + b, 0) >= asked
        );
        if (granted) return null;
        const params = getExtendAppRegistrationParams(JOURNAL_MCP_APP_ID, [FEED_DRIVE_REQUEST], undefined, undefined, undefined, appOrigin());
        return `https://${identity}/owner/appupdate?${stringifyToQueryParams(params)}`;
    }

    // As the app: a link to a public note goes to its share page, any other is its label.
    async function publicNoteUrl(id: string): Promise<string | null> {
        const file = await notesProvider.getNote(id).catch(() => null);
        const live = file && file.fileMetadata.appData.archivalStatus !== 2;
        return live && file.fileMetadata.appData.content?.isPublic ? noteShareUrl(appOrigin(), identity, id) : null;
    }

    return {
        missingGrantUrl,
        publish: (note) =>
            publishNoteToFeed(client, {
                ydoc: note.doc,
                title: note.metadata.title,
                noteFileId: note.fileId,
                feedPostId: note.metadata.feedPostId,
                publicNoteUrl,
                bakeImage: stripForFeed,
            }),
        postUrl: async (postId) => {
            const post = await getPostByGlobalTransitId(client, BlogConfig.PublicChannelId, postId);
            const key = post?.fileMetadata.appData.content.slug || postId;
            return `https://${identity}/posts/${BlogConfig.PublicChannelSlug}/${key}`;
        },
    };
}

/**
 * Implements ReadDeps (src/lib/agent/tools/read.ts) and the drive half of WriteDeps
 * (src/lib/agent/tools/write.ts; `clientName` comes from the MCP server) against the real Homebase drive, using the same
 * NotesDriveProvider/FolderDriveProvider the app uses (imported directly, not through the
 * @/lib/homebase barrel, which also re-exports SyncService and pulls in PGlite).
 */
export function createDriveDeps(creds: McpCredentials): McpDriveDeps {
    const client = createClient(creds);
    const notesProvider = new NotesDriveProvider(client);
    const folderProvider = new FolderDriveProvider(client);
    const grantsProvider = new AgentGrantsDriveProvider(client);

    // Re-fetched from the drive on every call, so a revocation applies on the very next call.
    const loadGrants = async () => (await grantsProvider.load()).grants;

    const listFolders = () =>
        collectPages(async (cursor) => {
            const page = await folderProvider.queryFolders(cursor);
            const items = page.folders.map((file) => {
                const uniqueId = file.fileMetadata.appData.uniqueId;
                const content = file.fileMetadata.appData.content;
                return uniqueId && content ? { id: uniqueId, name: content.name, isPublic: content.isPublic === true } : null;
            });
            return { items, cursor: page.cursor };
        });

    const listNotes = () =>
        collectPages(async (cursor) => {
            const page = await notesProvider.queryNotes(cursor, 100);
            return { items: page.notes.map(toNoteSummary), cursor: page.cursor };
        });

    async function fetchNoteForEdit(id: string): Promise<NoteForEdit | null> {
        const file = await notesProvider.getNote(id, undefined, { decrypt: false });
        if (!file) return null;

        // Fetched with decrypt:false so the header keeps its encrypted key header for the
        // upload; the content is still the encrypted string (getNote's type says otherwise)
        // and is decrypted separately.
        // Load the stored state, never a fresh doc, so the edit is causally after it.
        const [content, payload] = await Promise.all([
            notesProvider.dsrToContent(file, true),
            notesProvider.getNotePayload(file.fileId, undefined, file.fileMetadata.updated),
        ]);
        if (!content) return null;
        const appData = { ...file.fileMetadata.appData, content };
        const summary = toNoteSummary({ ...file, fileMetadata: { ...file.fileMetadata, appData } });
        if (!summary) return null;

        const doc = new Y.Doc();
        if (payload && payload.length > 0) Y.applyUpdate(doc, payload);

        const metadata: DocumentMetadata = {
            title: content.title,
            folderId: summary.folderId,
            tags: content.tags,
            timestamps: {
                created: new Date(file.fileMetadata.appData.userDate || file.fileMetadata.created).toISOString(),
                modified: summary.modified,
            },
            excludeFromAI: content.excludeFromAI ?? false,
            isPinned: content.isPinned,
            isPublic: content.isPublic,
            // Kept so an agent edit of a public note keeps its link-card text and indexing.
            shareDescription: content.shareDescription,
            shareIndexable: content.shareIndexable,
            // Kept so a publish to the feed after an agent edit updates the same post (#1074).
            feedPostId: content.feedPostId,
            archivalStatus: file.fileMetadata.appData.archivalStatus,
            isCollaborative: content.isCollaborative,
            circleIds: content.circleIds,
            odinIds: content.odinIds,
            recipients: content.recipients,
            viewerCircleIds: content.viewerCircleIds,
            viewerRecipients: content.viewerRecipients,
            lastEditedBy: content.lastEditedBy,
            shareRequest: content.shareRequest,
        };

        return {
            summary,
            doc,
            versionTag: file.fileMetadata.versionTag,
            fileId: file.fileId,
            // Reused by the upload that follows (as SyncService caches it) so the payload is
            // encrypted with the file's own key.
            keyHeader: file.sharedSecretEncryptedKeyHeader,
            metadata,
        };
    }

    async function getNote(id: string, targets?: readonly LinkTarget[]): Promise<{ summary: NoteSummary; markdown: string } | null> {
        const note = await fetchNoteForEdit(id);
        return note ? { summary: note.summary, markdown: toMarkdown(note.doc, targets) } : null;
    }

    /** The note's `modified` as the drive has it now: an upload's result doesn't carry it. */
    async function modifiedOf(id: string): Promise<string> {
        const file = await notesProvider.getNote(id, undefined, { decrypt: false });
        if (!file) throw new Error(`Note not found: ${id}`);
        return new Date(file.fileMetadata.updated).toISOString();
    }

    async function uploadNoteEdit(id: string, edit: NoteEdit): Promise<string> {
        await notesProvider.updateNote(
            id,
            edit.fileId,
            edit.versionTag,
            edit.metadata,
            undefined,
            undefined,
            edit.yjsBlob,
            edit.keyHeader,
            {
                onVersionConflict: () => {
                    throw new VersionConflictError();
                },
                toDeletePayloads: edit.toDeletePayloads?.map((key) => ({ key })),
            }
        );
        return modifiedOf(id);
    }

    async function uploadNoteImage(id: string, versionTag: string, image: PreparedImage, minIndex: number): Promise<string> {
        const file = new Blob([new Uint8Array(image.bytes)], { type: image.contentType });
        // No canvas in Node for thumbnails: the natural size makes the image its own thumbnail.
        const naturalSize = { pixelWidth: image.width, pixelHeight: image.height };
        const { payloadKey } = await notesProvider.addImageToNote(id, versionTag, { file, naturalSize }, minIndex);
        return payloadKey;
    }

    async function createNote(uniqueId: string, metadata: DocumentMetadata, yjsBlob: Uint8Array): Promise<string> {
        await notesProvider.createNote(uniqueId, metadata, yjsBlob);
        return modifiedOf(uniqueId);
    }

    async function setNotePublic(id: string, fileId: string, isPublic: boolean): Promise<string> {
        // As the app's setNoteShared: a re-upload that re-keys every payload, with the link card on a public note.
        if (isPublic) {
            const note = await fetchNoteForEdit(id);
            if (!note) throw new Error(`Note not found: ${id}`);
            await notesProvider.makeNotePublic(id, fileId, buildPublicCard(Y.encodeStateAsUpdate(note.doc), note.metadata));
        } else {
            await notesProvider.makeNotePrivate(id, fileId);
        }
        return modifiedOf(id);
    }

    async function createFolder(uniqueId: string, name: string): Promise<void> {
        // Same shape as the app's folder push (SyncService).
        await folderProvider.createFolder(uniqueId, { name, isCollaborative: false, needsPassword: false });
    }

    async function trashNote(id: string, fileId: string): Promise<void> {
        // The same header-only patch as the app's trashNote (SyncService.setNoteArchivalStatusRemote).
        await notesProvider.setNoteArchivalStatus(id, 2, fileId);
    }

    async function grantFolder(folderId: string, access: AgentAccess): Promise<void> {
        // Read-modify-write; on a conflict (the owner saved grants meanwhile) reload and reapply.
        for (let attempt = 0; attempt < 3; attempt++) {
            const { grants, versionTag, fileId } = await grantsProvider.load();
            try {
                await grantsProvider.save(setFolderAccess(grants, folderId, access), versionTag, fileId);
                return;
            } catch (err) {
                if (!(err instanceof Error && err.message === 'AGENT_GRANTS_CONFLICT')) throw err;
            }
        }
        throw new Error('Agent grants changed too often; try again');
    }

    return {
        loadGrants,
        listFolders,
        listNotes,
        getNote,
        fetchNoteForEdit,
        uploadNoteEdit,
        uploadNoteImage,
        createNote,
        createFolder,
        setNotePublic,
        trashNote,
        grantFolder,
        ownerIdentity: () => creds.identity,
        shareLink: (id) => noteShareUrl(appOrigin(), creds.identity, id),
        feed: createFeedDeps(client, notesProvider, creds.identity),
    };
}
