// Link-preview meta for public share links (/share/<identity>/<noteId>).
// Pure code with no Workers globals, so vitest can run it under node.

// Copies of JOURNAL_DRIVE in src/lib/homebase/config.ts. Importing src/ here
// would pull the Homebase SDK into the Function bundle.
export const JOURNAL_DRIVE_ALIAS = 'd5f411fa83fd4854a3bd7e974cc9bca9';
export const JOURNAL_DRIVE_TYPE = '30743710039d4b97bbd352f343d1c9df';

export const IDENTITY_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const NOTE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_KEY_RE = /^jrnl_img\d+$/;
// Copy of PAYLOAD_KEY_CARD_IMAGE in src/lib/homebase/config.ts: the 1200×630 card image (#441).
export const CARD_IMAGE_KEY = 'jrnl_card';
const MAX_HEADER_BYTES = 262144;
const START_MARKER = '<!-- share-meta:start -->';
const END_MARKER = '<!-- share-meta:end -->';

export type ShareMeta = {
    identity: string;
    noteId: string;
    fileId: string;
    title: string;
    description?: string;
    coverKey?: string;
    cardImageKey?: string;
    indexable: boolean;
    published?: string;
    modified?: string;
    authorName: string;
};

export function parseSharePath(pathname: string): { identity: string; noteId: string } | null {
    const match = /^\/share\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
    if (!match) return null;
    let identity: string;
    try {
        identity = decodeURIComponent(match[1]).toLowerCase();
    } catch {
        return null;
    }
    const noteId = match[2];
    if (!IDENTITY_RE.test(identity) || !NOTE_ID_RE.test(noteId)) return null;
    return { identity, noteId };
}

/** The author's Homebase origin. `override` is HOMEBASE_UPSTREAM_OVERRIDE, set only by the e2e edge harness. */
export function upstreamBase(identity: string, override?: string): string {
    return override ? override.replace(/\/+$/, '') : `https://${identity}`;
}

export function fallbackShareDescription(author: string): string {
    return `A note by ${author}, shared with Journal`;
}

export function isoDate(value: unknown): string | undefined {
    if (typeof value !== 'number' && typeof value !== 'string') return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function fetchAuthorName(url: string, fetchImpl: typeof fetch): Promise<string | undefined> {
    try {
        const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) });
        if (res.status !== 200) return undefined;
        const profile = (await res.json()) as { name?: unknown };
        return typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : undefined;
    } catch {
        return undefined;
    }
}

type HeaderJson = {
    fileId?: string;
    fileMetadata?: {
        created?: number;
        updated?: number;
        isEncrypted?: boolean;
        appData?: { content?: unknown; userDate?: number; archivalStatus?: number };
        payloads?: Array<{ key?: string }>;
    };
};

type NoteContent = {
    title?: unknown;
    card?: { description?: unknown; coverKey?: unknown; cardImageKey?: unknown; indexable?: unknown };
};

export async function fetchShareMeta(
    identity: string,
    noteId: string,
    fetchImpl: typeof fetch,
    override?: string,
): Promise<ShareMeta | null> {
    try {
        const base = upstreamBase(identity, override);
        const query = new URLSearchParams({
            alias: JOURNAL_DRIVE_ALIAS,
            type: JOURNAL_DRIVE_TYPE,
            clientUniqueId: noteId,
        });
        const [headerRes, authorName] = await Promise.all([
            fetchImpl(`${base}/api/guest/v1/drive/query/specialized/cuid/header?${query}`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(1500),
                headers: { accept: 'application/json' },
            }),
            fetchAuthorName(`${base}/pub/profile`, fetchImpl),
        ]);

        if (headerRes.status !== 200) return null;
        if (Number(headerRes.headers.get('content-length') ?? 0) > MAX_HEADER_BYTES) return null;
        const text = await headerRes.text();
        if (text.length > MAX_HEADER_BYTES) return null;
        const header = JSON.parse(text) as HeaderJson;

        const metadata = header.fileMetadata;
        if (!header.fileId || !metadata) return null;
        if (metadata.isEncrypted === true) return null;
        if (metadata.appData?.archivalStatus === 2) return null;

        const raw = metadata.appData?.content;
        const content = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as NoteContent;
        const card = content.card ?? {};

        const title = (typeof content.title === 'string' && content.title.trim()) || 'Untitled';
        const description =
            typeof card.description === 'string' && card.description.trim()
                ? card.description.trim().slice(0, 300)
                : undefined;
        const payloadKeys = (metadata.payloads ?? []).map((p) => p.key);
        const coverKey =
            typeof card.coverKey === 'string' && COVER_KEY_RE.test(card.coverKey) && payloadKeys.includes(card.coverKey)
                ? card.coverKey
                : undefined;
        const cardImageKey =
            card.cardImageKey === CARD_IMAGE_KEY && payloadKeys.includes(CARD_IMAGE_KEY) ? CARD_IMAGE_KEY : undefined;

        return {
            identity,
            noteId,
            fileId: header.fileId,
            title: title.slice(0, 200),
            description,
            coverKey,
            cardImageKey,
            indexable: card.indexable === true,
            published: isoDate(metadata.appData?.userDate ?? metadata.created),
            modified: isoDate(metadata.updated),
            authorName: authorName ?? identity,
        };
    } catch {
        return null;
    }
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildHeadTags(meta: ShareMeta, pageUrl: string, origin: string): string {
    const description = meta.description ?? fallbackShareDescription(meta.authorName);
    const authorUrl = `https://${meta.identity}`;
    const drive = { alias: JOURNAL_DRIVE_ALIAS, type: JOURNAL_DRIVE_TYPE, fileId: meta.fileId };
    // Crawlers cache og:image by URL; the modified time changes it when the cover or card does.
    const version: Record<string, string> = meta.modified ? { v: String(Date.parse(meta.modified)) } : {};
    // The card image is already 1200×630, so it's served as is. Notes published (or last
    // saved) before it existed fall back to a thumb of the raw cover, then to the site banner.
    const image = meta.cardImageKey
        ? `${authorUrl}/api/guest/v1/drive/files/payload?${new URLSearchParams({ ...drive, key: meta.cardImageKey, ...version })}`
        : meta.coverKey
          ? `${authorUrl}/api/guest/v1/drive/files/thumb?${new URLSearchParams({
                ...drive,
                payloadKey: meta.coverKey,
                width: '1600',
                height: '1600',
                ...version,
            })}`
          : `${origin}/banner.webp`;

    const property = (name: string, content: string | undefined) =>
        content === undefined ? [] : [`<meta property="${name}" content="${escapeHtml(content)}" />`];
    const named = (name: string, content: string) => `<meta name="${name}" content="${escapeHtml(content)}" />`;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: meta.title,
        description,
        datePublished: meta.published,
        dateModified: meta.modified,
        author: { '@type': 'Person', name: meta.authorName, url: authorUrl },
        image,
        mainEntityOfPage: pageUrl,
    };

    return [
        `<title>${escapeHtml(meta.title)} · Journal</title>`,
        named('description', description),
        `<link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
        ...(meta.indexable ? [] : [named('robots', 'noindex')]),
        ...property('og:type', 'article'),
        ...property('og:site_name', 'Journal'),
        ...property('og:title', meta.title),
        ...property('og:description', description),
        ...property('og:url', pageUrl),
        ...property('og:image', image),
        ...(meta.cardImageKey ? [...property('og:image:width', '1200'), ...property('og:image:height', '630')] : []),
        ...property('og:image:alt', meta.title),
        // Every image is wide: the 1200×630 card (#434), a cover, or the banner.
        named('twitter:card', 'summary_large_image'),
        named('twitter:title', meta.title),
        named('twitter:description', description),
        named('twitter:image', image),
        ...property('article:published_time', meta.published),
        ...property('article:modified_time', meta.modified),
        ...property('article:author', meta.authorName),
        `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    ]
        .map((tag) => `    ${tag}`)
        .join('\n')
        .trimStart();
}

export function injectShareMeta(html: string, headTags: string): string {
    const start = html.indexOf(START_MARKER);
    const end = html.indexOf(END_MARKER, start);
    if (start === -1 || end === -1) return html;
    return html.slice(0, start) + headTags + html.slice(end + END_MARKER.length);
}
