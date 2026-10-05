/**
 * #451: Make public / Make private re-upload the whole note. Homebase serves payload and
 * thumbnail GETs with `cache-control: max-age=31536000`, and the only thing that changes
 * their URL is the `lastModified` query param. A re-upload that reads them without it can
 * be handed the jrnl_txt the browser cached on an earlier toggle, and would overwrite the
 * newer server copy with it.
 *
 * The real SDK payload reads (getPayloadBytes / getThumbBytes) run here over a fake axios
 * client that behaves like the browser HTTP cache: the first response for a URL is kept
 * and served again for that exact URL. Header reads and uploads are modelled at the SDK
 * boundary by a small in-memory server.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    SecurityGroupType,
    type AccessControlList,
    type DotYouClient,
    type PayloadFile,
    type ThumbnailFile,
    type UploadFileMetadata,
    type UploadInstructionSet,
} from '@homebase-id/js-lib/core';

const { mockGetHeader, mockUploadFile } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockUploadFile: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeader: mockGetHeader,
        getFileHeaderByUniqueId: mockGetHeader,
        uploadFile: mockUploadFile,
        // Same steps as the SDK's reUploadFile (DriveFileUploader): read the header, read
        // each payload and thumbnail with no lastModified, upload them back. Here so the
        // old call path runs against the same fake cache and fails this test.
        reUploadFile: async (
            client: DotYouClient,
            instructions: UploadInstructionSet,
            metadata: UploadFileMetadata,
            encrypt: boolean,
        ) => {
            const drive = instructions.storageOptions!.drive;
            const fileId = instructions.storageOptions!.overwriteFileId!;
            const header = await mockGetHeader(client, drive, fileId);
            const payloads: PayloadFile[] = [];
            const thumbnails: ThumbnailFile[] = [];
            for (const p of header.fileMetadata.payloads) {
                const data = await actual.getPayloadBytes(client, drive, fileId, p.key, { decrypt: true });
                if (!data) continue;
                payloads.push({ key: p.key, payload: new Blob([new Uint8Array(data.bytes)], { type: p.contentType }) });
                for (const t of p.thumbnails) {
                    const thumb = await actual.getThumbBytes(client, drive, fileId, p.key, t.pixelWidth, t.pixelHeight, {});
                    if (thumb) thumbnails.push({ key: p.key, payload: new Blob([new Uint8Array(thumb.bytes)], { type: t.contentType }), pixelWidth: t.pixelWidth, pixelHeight: t.pixelHeight });
                }
            }
            return mockUploadFile(client, instructions, metadata, payloads, thumbnails, encrypt);
        },
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { PAYLOAD_KEY_CONTENT } from '@/lib/homebase/config';

const NOTE_ID = '45145145-1451-4514-5145-145145145145';
const FILE_ID = 'file-451';
const IMAGE_KEY = 'jrnl_img0';
const IMAGE = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const THUMB = new Uint8Array([9, 8, 7]);

interface StoredThumb { pixelWidth: number; pixelHeight: number; contentType: string; bytes: Uint8Array }
interface StoredPayload { contentType: string; lastModified: number; bytes: Uint8Array; thumbs: StoredThumb[] }

const text = (s: string) => new TextEncoder().encode(s);
const untext = (b: Uint8Array) => new TextDecoder().decode(b);

let clock: number;
let server: {
    versionTag: string;
    isEncrypted: boolean;
    acl: AccessControlList;
    content: string;
    payloads: Map<string, StoredPayload>;
};
let httpCache: Map<string, unknown>;
let cacheHits: string[];
let payloadGets: string[];

function header() {
    return {
        fileId: FILE_ID,
        fileMetadata: {
            versionTag: server.versionTag,
            isEncrypted: server.isEncrypted,
            appData: { uniqueId: NOTE_ID, groupId: 'main', userDate: 1, tags: [], content: server.content },
            payloads: [...server.payloads].map(([key, p]) => ({
                key,
                contentType: p.contentType,
                lastModified: p.lastModified,
                bytesWritten: p.bytes.length,
                thumbnails: p.thumbs.map(({ pixelWidth, pixelHeight, contentType }) => ({ pixelWidth, pixelHeight, contentType })),
            })),
        },
        serverMetadata: { accessControlList: server.acl },
    };
}

/** A GET the server answers. Payloads come back plaintext: encryption isn't under test here. */
function serve(url: string) {
    const params = new URLSearchParams(url.split('?')[1]);
    const payload = server.payloads.get(params.get('key') ?? params.get('payloadKey') ?? '');
    if (!payload) throw Object.assign(new Error('not found'), { response: { status: 404 } });
    const thumb = url.startsWith('/drive/files/thumb')
        ? payload.thumbs.find((t) => String(t.pixelWidth) === params.get('width'))
        : undefined;
    const bytes = thumb ? thumb.bytes : payload.bytes;
    return {
        data: bytes.slice().buffer,
        headers: { payloadencrypted: 'False', decryptedcontenttype: thumb?.contentType ?? payload.contentType },
    };
}

const client = {
    getHostIdentity: () => 'me.dotyou.cloud',
    createAxiosClient: () => ({
        get: async (url: string) => {
            payloadGets.push(url);
            // max-age=31536000: the browser reuses the response for this exact URL.
            if (httpCache.has(url)) {
                cacheHits.push(url);
                return httpCache.get(url);
            }
            const response = serve(url);
            httpCache.set(url, response);
            return response;
        },
    }),
} as unknown as DotYouClient;

/** An edit pushed by sync: a write, so it never goes through the GET cache. */
function pushEdit(content: string) {
    const current = server.payloads.get(PAYLOAD_KEY_CONTENT)!;
    server.payloads.set(PAYLOAD_KEY_CONTENT, { ...current, bytes: text(content), lastModified: ++clock });
    server.versionTag = `v${clock}`;
}

const serverText = () => untext(server.payloads.get(PAYLOAD_KEY_CONTENT)!.bytes);

describe('make public / make private keep the latest edit (#451)', () => {
    let provider: NotesDriveProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        clock = 1;
        httpCache = new Map();
        cacheHits = [];
        payloadGets = [];
        server = {
            versionTag: 'v1',
            isEncrypted: true,
            acl: { requiredSecurityGroup: SecurityGroupType.Owner },
            content: JSON.stringify({ title: 'Note', tags: [] }),
            payloads: new Map([
                [PAYLOAD_KEY_CONTENT, { contentType: 'application/yjs', lastModified: 1, bytes: text('edit 1'), thumbs: [] }],
                [IMAGE_KEY, {
                    contentType: 'image/png',
                    lastModified: 1,
                    bytes: IMAGE,
                    thumbs: [{ pixelWidth: 20, pixelHeight: 10, contentType: 'image/webp', bytes: THUMB }],
                }],
            ]),
        };
        mockGetHeader.mockImplementation(async () => header());
        mockUploadFile.mockImplementation(async (
            _client: DotYouClient,
            _instructions: UploadInstructionSet,
            metadata: UploadFileMetadata,
            payloads: PayloadFile[],
            thumbnails: ThumbnailFile[],
            encrypt: boolean,
        ) => {
            const now = ++clock;
            const stored = new Map<string, StoredPayload>();
            for (const p of payloads) {
                const thumbs: StoredThumb[] = [];
                for (const t of thumbnails.filter((t) => t.key === p.key)) {
                    thumbs.push({ pixelWidth: t.pixelWidth, pixelHeight: t.pixelHeight, contentType: t.payload.type, bytes: new Uint8Array(await t.payload.arrayBuffer()) });
                }
                stored.set(p.key, { contentType: p.payload.type, lastModified: now, bytes: new Uint8Array(await p.payload.arrayBuffer()), thumbs });
            }
            server = {
                versionTag: `v${now}`,
                isEncrypted: encrypt,
                acl: metadata.accessControlList!,
                content: metadata.appData.content as string,
                payloads: stored,
            };
            return { newVersionTag: server.versionTag };
        });
        provider = new NotesDriveProvider(client);
    });

    it('public, edit, private, edit, public uploads the latest jrnl_txt every time', async () => {
        await provider.makeNotePublic(NOTE_ID, FILE_ID);
        expect(serverText()).toBe('edit 1');

        pushEdit('edit 2');
        await provider.makeNotePrivate(NOTE_ID, FILE_ID);
        expect(serverText()).toBe('edit 2');

        pushEdit('edit 3');
        await provider.makeNotePublic(NOTE_ID, FILE_ID);
        expect(serverText()).toBe('edit 3');

        expect(cacheHits).toEqual([]);
        expect(payloadGets.length).toBeGreaterThan(0);
        for (const url of payloadGets) expect(url).toMatch(/[?&]lastModified=\d+/);
    });

    it('keeps the image and its thumbnail, and the public ACL, across toggles', async () => {
        await provider.makeNotePublic(NOTE_ID, FILE_ID);
        await provider.makeNotePrivate(NOTE_ID, FILE_ID);
        await provider.makeNotePublic(NOTE_ID, FILE_ID);

        const image = server.payloads.get(IMAGE_KEY)!;
        expect(image.contentType).toBe('image/png');
        expect([...image.bytes]).toEqual([...IMAGE]);
        expect(image.thumbs).toEqual([{ pixelWidth: 20, pixelHeight: 10, contentType: 'image/webp', bytes: THUMB }]);
        expect(server.isEncrypted).toBe(false);
        expect(server.acl.requiredSecurityGroup).toBe(SecurityGroupType.Anonymous);
        expect(JSON.parse(server.content).isPublic).toBe(true);
    });
});
