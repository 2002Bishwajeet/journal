// A list of an author's public notes (#515):
// /share/<identity> (HTML) and /share/<identity>/sitemap.xml, and the notes of
// one shared folder (#619): /share/<identity>/f/<folderId>.
// Pure code with no Workers globals, so vitest can run it under node.

import {
    IDENTITY_RE,
    JOURNAL_DRIVE_ALIAS,
    JOURNAL_DRIVE_TYPE,
    NOTE_ID_RE,
    escapeHtml,
    fetchAuthorName,
    isoDate,
    upstreamBase,
} from './shareMeta';

// Copy of JOURNAL_FILE_TYPE in src/lib/homebase/config.ts.
export const JOURNAL_FILE_TYPE = 605;
export const MAX_INDEX_NOTES = 500;
const MAX_QUERY_BYTES = 8 * 1024 * 1024;
const MAX_FOLDER_BYTES = 262144;

// `indexable` is the note's "Hide from search engines" switch: it only decides
// the sitemap, never the author page (which lists every public note).
export type IndexNote = { noteId: string; title: string; indexable: boolean; published?: string; modified?: string };

// `folder` is set for a shared folder's page (#619): the notes are that folder's.
export type AuthorIndex = {
    identity: string;
    authorName: string;
    notes: IndexNote[];
    folder?: { id: string; name: string };
};

export type AuthorPath = { identity: string | null; kind: 'index' | 'sitemap' } | { identity: string | null; kind: 'folder'; folderId: string | null };

/**
 * `/share/<identity>[/]`, `/share/<identity>/sitemap.xml` or
 * `/share/<identity>/f/<folderId>[/]`. Null for any other path; `identity` or
 * `folderId` is null when the path has that shape but the value is invalid.
 */
export function parseAuthorPath(pathname: string): AuthorPath | null {
    const match = /^\/share\/([^/]+)(?:(\/|\/sitemap\.xml)|\/f\/([^/]+)\/?)?$/.exec(pathname);
    if (!match) return null;
    let identity: string | null;
    try {
        const decoded = decodeURIComponent(match[1]).toLowerCase();
        identity = IDENTITY_RE.test(decoded) ? decoded : null;
    } catch {
        identity = null;
    }
    if (match[3] !== undefined) return { identity, kind: 'folder', folderId: NOTE_ID_RE.test(match[3]) ? match[3].toLowerCase() : null };
    return { identity, kind: match[2] === '/sitemap.xml' ? 'sitemap' : 'index' };
}

type QueryFile = {
    fileMetadata?: {
        created?: number;
        updated?: number;
        isEncrypted?: boolean;
        appData?: { uniqueId?: unknown; groupId?: unknown; content?: unknown; userDate?: number; archivalStatus?: number };
    };
};

function toIndexNote(file: QueryFile, folderId?: string): IndexNote | null {
    try {
        const metadata = file.fileMetadata;
        const appData = metadata?.appData;
        // The guest query only returns Anonymous files; the rest is defence in depth.
        if (!metadata || !appData || metadata.isEncrypted !== false || appData.archivalStatus === 2) return null;
        if (typeof appData.uniqueId !== 'string' || !NOTE_ID_RE.test(appData.uniqueId)) return null;
        // The query already filters by folder; a note that says it is in another one is dropped too.
        if (folderId && typeof appData.groupId === 'string' && appData.groupId.toLowerCase() !== folderId) return null;
        const raw = appData.content;
        const content = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as {
            title?: unknown;
            card?: { indexable?: unknown };
        };
        const title = (typeof content.title === 'string' && content.title.trim()) || 'Untitled';
        return {
            noteId: appData.uniqueId.toLowerCase(),
            title: title.slice(0, 200),
            indexable: content.card?.indexable === true,
            published: isoDate(appData.userDate ?? metadata.created),
            modified: isoDate(metadata.updated),
        };
    } catch {
        return null;
    }
}

/**
 * A shared folder's name, from its guest-readable file. Null when the folder is
 * unknown or not shared (its file is Owner-only then, so the guest read fails).
 */
async function fetchFolderName(base: string, folderId: string, fetchImpl: typeof fetch): Promise<string | null> {
    try {
        const query = new URLSearchParams({
            alias: JOURNAL_DRIVE_ALIAS,
            type: JOURNAL_DRIVE_TYPE,
            clientUniqueId: folderId,
        });
        const res = await fetchImpl(`${base}/api/guest/v1/drive/query/specialized/cuid/header?${query}`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(3000),
            headers: { accept: 'application/json' },
        });
        if (res.status !== 200) return null;
        const text = await res.text();
        if (text.length > MAX_FOLDER_BYTES) return null;
        const metadata = (JSON.parse(text) as QueryFile).fileMetadata;
        if (!metadata || metadata.isEncrypted !== false || metadata.appData?.archivalStatus === 2) return null;
        const raw = metadata.appData?.content;
        const content = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as { name?: unknown; isPublic?: unknown };
        if (content.isPublic !== true || typeof content.name !== 'string' || !content.name.trim()) return null;
        return content.name.trim().slice(0, 200);
    } catch {
        return null;
    }
}

/**
 * The author's public notes, newest first, or with `folderId` only that shared
 * folder's. Null on any upstream failure, and for a folder that isn't shared.
 */
export async function fetchAuthorIndex(
    identity: string,
    fetchImpl: typeof fetch,
    override?: string,
    folderId?: string,
): Promise<AuthorIndex | null> {
    try {
        const base = upstreamBase(identity, override);
        const query = new URLSearchParams({
            alias: JOURNAL_DRIVE_ALIAS,
            type: JOURNAL_DRIVE_TYPE,
            fileType: String(JOURNAL_FILE_TYPE),
            fileState: '1',
            maxRecords: String(MAX_INDEX_NOTES),
            includeMetadataHeader: 'true',
            sorting: 'userDate',
            ordering: 'newestFirst',
        });
        if (folderId) query.set('groupId', folderId);
        const [queryRes, authorName, folderName] = await Promise.all([
            fetchImpl(`${base}/api/guest/v1/drive/query/batch?${query}`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(3000),
                headers: { accept: 'application/json' },
            }),
            fetchAuthorName(`${base}/pub/profile`, fetchImpl),
            folderId ? fetchFolderName(base, folderId, fetchImpl) : undefined,
        ]);

        if (folderId && !folderName) return null;
        if (queryRes.status !== 200) return null;
        if (Number(queryRes.headers.get('content-length') ?? 0) > MAX_QUERY_BYTES) return null;
        const text = await queryRes.text();
        if (text.length > MAX_QUERY_BYTES) return null;
        const results = (JSON.parse(text) as { searchResults?: unknown }).searchResults;
        if (!Array.isArray(results)) return null;

        const notes = (results as QueryFile[])
            .map((file) => toIndexNote(file, folderId))
            .filter((note): note is IndexNote => note !== null)
            .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
            .slice(0, MAX_INDEX_NOTES);
        return {
            identity,
            authorName: authorName ?? identity,
            notes,
            ...(folderId && folderName ? { folder: { id: folderId, name: folderName } } : {}),
        };
    } catch {
        return null;
    }
}

const noteUrl = (origin: string, identity: string, noteId: string) => `${origin}/share/${identity}/${noteId}`;

const formatDate = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

// The share page's palette (src/index.css), light and dark.
const STYLE = `
:root{color-scheme:light dark;--bg:#FDFCF8;--fg:#2C2B29;--muted:#8A8780;--border:#E6E4DD}
@media (prefers-color-scheme:dark){:root{--bg:#1C1B1A;--fg:#E6E4DD;--border:#3E3D3A}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}
.wrap{max-width:56rem;margin:0 auto;padding:0 1rem}
@media (min-width:640px){.wrap{padding:0 1.5rem}}
header .wrap{height:3.5rem;display:flex;align-items:center}
a{color:inherit}
.brand{display:flex;align-items:center;gap:.5rem;text-decoration:none}
.logo{width:1.5rem;height:1.5rem;border-radius:.375rem;overflow:hidden;flex-shrink:0}
.logo img{width:100%;height:100%;transform:scale(1.6)}
.serif{font-family:'Playfair Display',Georgia,'Times New Roman',serif;letter-spacing:-.01em}
.brand .serif{font-size:1.25rem;line-height:1}
main{padding-top:2rem;padding-bottom:2rem}
h1{font-size:2.25rem;line-height:1.2;margin:0 0 .25rem;font-weight:700}
.sub{color:var(--muted);margin:0 0 2rem;font-size:.875rem}
ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--border)}
li{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25rem 1rem;padding:1rem 0;border-bottom:1px solid var(--border)}
li a{font-size:1.125rem;font-weight:600;text-decoration:none}
li a:hover{text-decoration:underline;text-underline-offset:4px}
time,.empty{color:var(--muted);font-size:.875rem}
footer{border-top:1px solid var(--border);margin-top:4rem}
footer p{margin:0;padding:2rem 0;color:var(--muted);font-size:.75rem}
`;

/** The server-rendered author index page. No client JS. */
export function buildAuthorIndexHtml(index: AuthorIndex, origin: string): string {
    const { identity, authorName, notes, folder } = index;
    const pageUrl = folder ? `${origin}/share/${identity}/f/${folder.id}` : `${origin}/share/${identity}`;
    const title = folder ? folder.name : `Notes by ${authorName}`;
    const description = folder
        ? `Notes in the folder ${folder.name} by ${authorName}, shared with Journal`
        : `Public notes by ${authorName}, shared with Journal`;
    const property = (name: string, content: string) => `<meta property="${name}" content="${escapeHtml(content)}" />`;
    const named = (name: string, content: string) => `<meta name="${name}" content="${escapeHtml(content)}" />`;

    const items = notes
        .map((note) => {
            const date = note.published
                ? `<time datetime="${note.published}">${escapeHtml(formatDate(note.published))}</time>`
                : '';
            return `<li><a href="${escapeHtml(noteUrl(origin, identity, note.noteId))}">${escapeHtml(note.title)}</a>${date}</li>`;
        })
        .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Journal</title>
${named('description', description)}
<link rel="canonical" href="${escapeHtml(pageUrl)}" />
${notes.some((note) => note.indexable) ? '' : `${named('robots', 'noindex')}\n`}${property('og:type', 'website')}
${property('og:site_name', folder ? authorName : 'Journal')}
${property('og:title', title)}
${property('og:description', description)}
${property('og:url', pageUrl)}
${property('og:image', `${origin}/banner.webp`)}
${named('twitter:card', 'summary')}
${named('twitter:title', title)}
${named('twitter:description', description)}
<link rel="icon" href="/favicon.ico" sizes="any" />
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap"><a class="brand" href="/"><span class="logo"><img src="/logo.webp" alt="" /></span><span class="serif">Journal</span></a></div></header>
<main class="wrap">
<h1 class="serif">${escapeHtml(folder ? folder.name : authorName)}</h1>
<p class="sub">${folder ? `Shared folder by <a href="${escapeHtml(`${origin}/share/${identity}`)}">${escapeHtml(authorName)}</a>` : `Public notes by ${escapeHtml(identity)}`}</p>
${notes.length ? `<ol>\n${items}\n</ol>` : '<p class="empty">No public notes listed.</p>'}
</main>
<footer><div class="wrap"><p>Published by ${escapeHtml(identity)}. Content is the author's own and is not reviewed by Journal.</p></div></footer>
</body>
</html>
`;
}

/** The indexable notes as a sitemap, with each note's last change as `<lastmod>`. */
export function buildSitemapXml(index: AuthorIndex, origin: string): string {
    const urls = index.notes
        .filter((note) => note.indexable)
        .map((note) => {
            const lastmod = note.modified ?? note.published;
            return `  <url><loc>${escapeHtml(noteUrl(origin, index.identity, note.noteId))}</loc>${
                lastmod ? `<lastmod>${lastmod}</lastmod>` : ''
            }</url>`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
