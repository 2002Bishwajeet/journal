import { randomBytes } from 'node:crypto';
import { MAX_IMAGE_BYTES, assertImageByteSize, prepareImageBytes, type PreparedImage } from '@/lib/images/imageBytes';
import { loadImage } from '../imageSource';
import type { SqliteKv } from './kv';
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

export const PATHS_REFUSED =
    'The hosted Journal server cannot read files on your computer. Upload the image with create_image_upload and pass its upload:// source, or pass an https: image URL.';
const NOT_FOUND =
    'Upload not found: it expired (an hour after it was uploaded), was already placed in a note, or belongs to another connection. Create a new one with create_image_upload.';
const NOT_UPLOADED = 'Nothing has been uploaded to this upload yet: POST the image to its upload_url first, or give the user the link to open.';
const LINK_EXPIRED = 'This upload link has expired or was already used. Ask your agent for a new one.';
const NOT_MULTIPART = 'Send the image as multipart form data in the "file" field: curl -F file=@photo.jpg <upload_url>';

const ID = /^[\w-]{43}$/;
const pendingKey = (id: string) => `hosted:upload:${id}`;
const uploadedKey = (id: string) => `hosted:uploaded:${id}`;

interface Pending {
    grant: string;
    filename: string;
}
interface Uploaded {
    grant: string;
    /** The image, checked and stripped of metadata, as base64. */
    image: string;
}

/**
 * A web image's bytes: public addresses only (publicOnlyAgent checks each address it connects to, after
 * resolving, so DNS rebinding can't reach the box), no redirects, a timeout and the 5 MB cap while reading.
 */
export async function fetchImage(url: string): Promise<Uint8Array> {
    const init = { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), dispatcher: publicOnlyAgent } as RequestInit;
    const response = await fetch(url, init).catch((cause: unknown) => {
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

/** The hosted server's images, kept in `kv`; `grant` is always the grant id of the MCP request at hand. */
export function hostedImages(kv: SqliteKv, origin: string) {
    /** The upload id after `prefix` (UPLOAD_PATH or SOURCE), if well formed. */
    const idOf = (text: string, prefix = UPLOAD_PATH) => {
        const id = text.startsWith(prefix) ? text.slice(prefix.length) : '';
        return ID.test(id) ? id : null;
    };
    const pendingOf = async (id: string | null) => (id ? ((await kv.get(pendingKey(id), 'json')) as Pending | null) : null);

    return {
        /** create_image_upload: a fresh single-use upload URL for this grant. */
        async create(grant: string, filename: string) {
            const id = randomBytes(32).toString('base64url');
            await kv.put(pendingKey(id), JSON.stringify({ grant, filename } satisfies Pending), { expirationTtl: UPLOAD_URL_TTL });
            return {
                upload_url: `${origin}${UPLOAD_PATH}${id}`,
                upload_headers: {},
                expires_at: new Date(Date.now() + UPLOAD_URL_TTL * 1000).toISOString(),
                source: `${SOURCE}${id}`,
            };
        },

        /** Whether `pathname` is a live upload URL: only then may an unauthenticated body be image-sized (mcp/hosted/node.ts). */
        async isLive(pathname: string): Promise<boolean> {
            return !!(await pendingOf(idOf(pathname)));
        },

        /** GET: the page a person uploads on. POST: the upload, as multipart with the image in `file`. */
        async serve(request: Request): Promise<Response> {
            const id = idOf(new URL(request.url).pathname);
            const pending = await pendingOf(id);
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
                // The link stays usable: the person can pick another image.
                return fail(400, (e as Error).message);
            }
            // Single use: of two uploads racing, one takes the link.
            if (!(await kv.take(pendingKey(id)))) return fail(404, LINK_EXPIRED);
            const uploaded: Uploaded = { grant: pending.grant, image: Buffer.from(image.bytes).toString('base64') };
            await kv.put(uploadedKey(id), JSON.stringify(uploaded), { expirationTtl: UPLOADED_TTL });
            if (wantsPage) return html(messagePage('Image uploaded', 'Go back to your chat and tell your agent the image is there.'), 200);
            return Response.json({ source: `${SOURCE}${id}`, contentType: image.contentType, width: image.width, height: image.height });
        },

        /**
         * The hosted image loader: an upload:// source this grant uploaded (placed once), an https: URL, or a small
         * data: URI. Never a path: that would be a file on this box, not the user's.
         */
        async load(grant: string, src: string): Promise<PreparedImage> {
            if (src.startsWith(SOURCE)) {
                const id = idOf(src, SOURCE);
                const uploaded = id ? ((await kv.get(uploadedKey(id), 'json')) as Uploaded | null) : null;
                if (id && uploaded?.grant === grant && (await kv.take(uploadedKey(id)))) {
                    return prepareImageBytes(new Uint8Array(Buffer.from(uploaded.image, 'base64')));
                }
                throw new Error((await pendingOf(id))?.grant === grant ? NOT_UPLOADED : NOT_FOUND);
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
