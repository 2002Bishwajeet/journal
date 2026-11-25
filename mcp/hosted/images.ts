import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fetch } from 'undici';
import { MAX_IMAGE_BYTES, assertImageByteSize, prepareImageBytes, type PreparedImage } from '@/lib/images/imageBytes';
import { loadImage } from '../imageSource';
import { html, messagePage, uploadPage, uploadPageCsp } from './pages';
import { publicOnlyAgent } from './publicFetch';

// Images on the hosted server (#1506), which can't read the user's files. create_image_upload hands the agent a
// single-use upload URL; the agent's own runtime POSTs the image there (or a person opens it and picks one), so
// the bytes never pass through the model. The image waits here, bound to the grant, until a tool places it.

export const UPLOAD_PATH = '/journal/upload/';
const SOURCE = 'upload://';
/** How long an upload URL takes its one POST, and how long an uploaded image waits to be placed, in seconds. */
const UPLOAD_URL_TTL = 15 * 60;
const UPLOADED_TTL = 60 * 60;
/** For tiny generated images: anything larger costs the model too many tokens, so it goes through an upload. */
const MAX_DATA_URI_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
/** Per user: upload URLs not yet used, and bytes uploaded and not yet placed. Then the whole server's bytes held. */
const MAX_LINKS_PER_USER = 5;
const MAX_HELD_PER_USER = 25 * 1024 * 1024;
const MAX_HELD = 500 * 1024 * 1024;
/** Refused POSTs an upload URL takes before it is gone. */
const MAX_FAILED_POSTS = 5;

export const PATHS_REFUSED =
    'The hosted Journal server cannot read files on your computer. Upload the image with create_image_upload and pass its upload:// source, or pass an https: image URL.';
const NOT_FOUND =
    'Upload not found: it expired (an hour after it was uploaded), was already placed in a note, or belongs to another connection. Create a new one with create_image_upload.';
const NOT_UPLOADED = 'Nothing has been uploaded to this upload yet: POST the image to its upload_url first, or give the user the link to open.';
const LINK_EXPIRED = 'This upload link has expired or was already used. Ask your agent for a new one.';
const NOT_MULTIPART = 'Send the image as multipart form data in the "file" field: curl -F file=@photo.jpg <upload_url>';
const TOO_MANY_LINKS = `At most ${MAX_LINKS_PER_USER} upload URLs can wait for an image at once: use one, or let it expire (15 minutes).`;
const TOO_MUCH_HELD = 'Too many uploaded images are waiting to be placed: place them in a note first, or let them expire (an hour after upload).';
const SERVER_FULL = 'Journal is holding too many uploads right now. Try again later.';

const ID = /^[\w-]{43}$/;
const now = () => Math.floor(Date.now() / 1000);

/**
 * The uploads, in their own SQLite file apart from the OAuth grants: a row per upload URL, its image a BLOB,
 * null until it is posted. secure_delete overwrites a placed or expired image's bytes in the file.
 */
export function uploadsDb(file: string): DatabaseSync {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA secure_delete = ON');
    db.exec(
        'CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, grant_id TEXT NOT NULL, filename TEXT NOT NULL, expiration INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, image BLOB)'
    );
    return db;
}

export function purgeUploads(db: DatabaseSync): void {
    db.prepare('DELETE FROM uploads WHERE expiration <= ?').run(now());
}

/**
 * A web image's bytes: public addresses only (publicOnlyAgent checks each address it connects to, after
 * resolving, so DNS rebinding can't reach the box), no redirects, a timeout and the 5 MB cap while reading.
 */
export async function fetchImage(url: string): Promise<Uint8Array> {
    // undici's own fetch: Node's global one bundles an older undici that can't drive this undici's Agent.
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), dispatcher: publicOnlyAgent }).catch((cause: unknown) => {
        throw new Error(`Could not fetch ${url}: Journal fetches images only from public https addresses, within ${FETCH_TIMEOUT_MS / 1000} s.`, { cause });
    });
    if (response.status !== 200) {
        void response.body?.cancel();
        const redirected = response.status >= 300 && response.status < 400 ? ': redirects are not followed, so pass the address it redirects to' : '';
        throw new Error(`${url} answered ${response.status}${redirected}`);
    }
    assertImageByteSize(Number(response.headers.get('content-length') ?? 0));
    const chunks: Uint8Array[] = [];
    const reader = response.body!.getReader();
    for (let size = 0; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_IMAGE_BYTES) {
            void reader.cancel();
            assertImageByteSize(size);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/** The hosted server's images, kept in `db` (uploadsDb); `grant` is always the grant id of the MCP request at hand. */
export function hostedImages(db: DatabaseSync, origin: string) {
    /** The upload id after `prefix` (UPLOAD_PATH or SOURCE), if well formed. */
    const idOf = (text: string, prefix = UPLOAD_PATH) => {
        const id = text.startsWith(prefix) ? text.slice(prefix.length) : '';
        return ID.test(id) ? id : null;
    };
    /** A live upload URL nothing was posted to yet. */
    const pendingOf = (id: string | null) =>
        (id ? db.prepare('SELECT user_id, grant_id, filename FROM uploads WHERE id = ? AND image IS NULL AND expiration > ?').get(id, now()) : undefined) as
            | { user_id: string; grant_id: string; filename: string }
            | undefined;
    /** Bytes of live uploads not yet placed: the user's, and the whole server's. */
    const held = (user: string) => {
        const sum = 'SELECT coalesce(sum(length(image)), 0) AS n FROM uploads WHERE image IS NOT NULL AND expiration > ?';
        const mine = db.prepare(`${sum} AND user_id = ?`).get(now(), user) as { n: number };
        const all = db.prepare(sum).get(now()) as { n: number };
        return { mine: mine.n, all: all.n };
    };

    return {
        /** create_image_upload: a fresh single-use upload URL for this user's grant. */
        async create(user: string, grant: string, filename: string) {
            const { n } = db.prepare('SELECT count(*) AS n FROM uploads WHERE user_id = ? AND image IS NULL AND expiration > ?').get(user, now()) as { n: number };
            if (n >= MAX_LINKS_PER_USER) throw new Error(TOO_MANY_LINKS);
            const id = randomBytes(32).toString('base64url');
            db.prepare('INSERT INTO uploads (id, user_id, grant_id, filename, expiration) VALUES (?, ?, ?, ?, ?)').run(id, user, grant, filename, now() + UPLOAD_URL_TTL);
            return {
                upload_url: `${origin}${UPLOAD_PATH}${id}`,
                upload_headers: {},
                expires_at: new Date(Date.now() + UPLOAD_URL_TTL * 1000).toISOString(),
                source: `${SOURCE}${id}`,
            };
        },

        /** Whether `pathname` is a live upload URL: only then may an unauthenticated body be image-sized (mcp/hosted/node.ts). */
        async isLive(pathname: string): Promise<boolean> {
            return !!pendingOf(idOf(pathname));
        },

        /** GET: the page a person uploads on. POST: the upload, as multipart with the image in `file`. */
        async serve(request: Request): Promise<Response> {
            const id = idOf(new URL(request.url).pathname);
            const pending = pendingOf(id);
            const wantsPage = request.headers.get('accept')?.includes('text/html');
            const fail = (status: number, text: string) =>
                wantsPage ? html(messagePage('The image was not uploaded', text), status) : Response.json({ error: text }, { status });
            if (!id || !pending) return fail(404, LINK_EXPIRED);
            if (request.method === 'GET') {
                const nonce = randomBytes(16).toString('base64');
                return html(uploadPage(pending.filename, nonce), 200, undefined, uploadPageCsp(nonce));
            }
            if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });

            let image: PreparedImage;
            try {
                const file = (await request.formData().catch(() => null))?.get('file');
                if (!(file instanceof File)) throw new Error(NOT_MULTIPART);
                assertImageByteSize(file.size);
                image = prepareImageBytes(new Uint8Array(await file.arrayBuffer()));
            } catch (e) {
                // The link stays usable for a few more tries: the person can pick another image.
                db.prepare('UPDATE uploads SET failures = failures + 1 WHERE id = ?').run(id);
                db.prepare('DELETE FROM uploads WHERE id = ? AND failures >= ?').run(id, MAX_FAILED_POSTS);
                return fail(400, (e as Error).message);
            }
            // No await from here on: the quota checks and the write that uses the link up happen together.
            const { mine, all } = held(pending.user_id);
            if (mine + image.bytes.length > MAX_HELD_PER_USER) return fail(429, TOO_MUCH_HELD);
            if (all + image.bytes.length > MAX_HELD) return fail(503, SERVER_FULL);
            // Single use: of two uploads racing, one takes the link.
            const used = db
                .prepare('UPDATE uploads SET image = ?, expiration = ? WHERE id = ? AND image IS NULL AND expiration > ?')
                .run(image.bytes, now() + UPLOADED_TTL, id, now());
            if (!used.changes) return fail(404, LINK_EXPIRED);
            if (wantsPage) return html(messagePage('Image uploaded', 'Go back to your chat and tell your agent the image is there.'), 200);
            return Response.json({ source: `${SOURCE}${id}`, contentType: image.contentType, width: image.width, height: image.height });
        },

        /**
         * The hosted image loader: an upload:// source this grant uploaded (placed once), an https: URL, or a small
         * data: URI. Never a path: that would be a file on this box, not the user's. A taken upload leaves a
         * `putBack` in `taken`, for the caller to run if the call placing it fails.
         */
        async load(grant: string, src: string, taken: (() => void)[] = []): Promise<PreparedImage> {
            if (src.startsWith(SOURCE)) {
                const id = idOf(src, SOURCE);
                const row = db
                    .prepare('DELETE FROM uploads WHERE id = ? AND grant_id = ? AND image IS NOT NULL AND expiration > ? RETURNING *')
                    .get(id, grant, now()) as { user_id: string; filename: string; expiration: number; image: Uint8Array } | undefined;
                if (row) {
                    taken.push(() =>
                        db.prepare('INSERT OR IGNORE INTO uploads (id, user_id, grant_id, filename, expiration, image) VALUES (?, ?, ?, ?, ?, ?)')
                            .run(id, row.user_id, grant, row.filename, row.expiration, row.image)
                    );
                    return prepareImageBytes(row.image);
                }
                throw new Error(pendingOf(id)?.grant_id === grant ? NOT_UPLOADED : NOT_FOUND);
            }
            if (src.startsWith('data:')) {
                // Base64: 4 characters for every 3 bytes.
                if (((src.length - src.indexOf(',') - 1) * 3) / 4 > MAX_DATA_URI_BYTES) {
                    throw new Error('A data: URI image can be at most 256 KB here: upload a larger one with create_image_upload.');
                }
                return loadImage(src);
            }
            if (/^https:\/\//i.test(src)) return prepareImageBytes(await fetchImage(src));
            throw new Error(PATHS_REFUSED);
        },
    };
}
