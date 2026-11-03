// A list of an author's public notes (#515):
// /share/<identity> (HTML) and /share/<identity>/sitemap.xml, and the notes of
// one shared folder (#619): /share/<identity>/f/<folderId>.
// Pure code with no Workers globals, so vitest can run it under node.

import { folderShareDescription } from './folderShare';
import {
    CARD_IMAGE_KEY,
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
// Copy of FOLDER_FILE_TYPE in src/lib/homebase/config.ts.
export const FOLDER_FILE_TYPE = 606;
export const MAX_FOLDER_PAGE_NOTES = 5;
export const MAX_INDEX_NOTES = 500;
const MAX_QUERY_BYTES = 8 * 1024 * 1024;
const MAX_FOLDER_BYTES = 262144;

// `indexable` is the note's "Hide from search engines" switch: it only decides
// the sitemap, never the author page (which lists every listed public note;
// an unlisted note (`card.unlisted`) is dropped everywhere). A folder whose
// notes are all unlisted is left out of the author page.
export type IndexNote = { noteId: string; groupId?: string; title: string; indexable: boolean; published?: string; modified?: string };

// `folder` is set for a shared folder's page (#619): the notes are that folder's.
export type AuthorIndex = {
    identity: string;
    authorName: string;
    notes: IndexNote[];
    folder?: { id: string; name: string; cardImage?: FolderCardImage };
    // The author page's shared folders (#632), each with its notes; `notes` then holds the rest.
    folders?: IndexFolder[];
};

// A shared folder's own 1200x630 link card: the `jrnl_card` payload of its file, `version` busting crawler caches.
export type FolderCardImage = { fileId: string; version?: number };

export type IndexFolder = { id: string; name: string; notes: IndexNote[] };

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
    fileId?: string;
    fileMetadata?: {
        payloads?: { key?: string }[];
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
            card?: { indexable?: unknown; unlisted?: unknown };
        };
        // Unlisted: public by link only, so it is on no list and not in the sitemap.
        if (content.card?.unlisted === true) return null;
        const title = (typeof content.title === 'string' && content.title.trim()) || 'Untitled';
        return {
            noteId: appData.uniqueId.toLowerCase(),
            ...(typeof appData.groupId === 'string' ? { groupId: appData.groupId.toLowerCase() } : {}),
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
 * A shared folder's name and link card, from its guest-readable file. Null when the folder is
 * unknown or not shared (its file is Owner-only then, so the guest read fails).
 */
async function fetchSharedFolder(
    base: string,
    folderId: string,
    fetchImpl: typeof fetch,
): Promise<{ name: string; cardImage?: FolderCardImage } | null> {
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
        const file = JSON.parse(text) as QueryFile;
        const metadata = file.fileMetadata;
        if (!metadata || metadata.isEncrypted !== false || metadata.appData?.archivalStatus === 2) return null;
        const name = sharedFolderName(metadata.appData?.content);
        if (!name) return null;
        // The card counts only when the content names it and the payload is there.
        const hasCard =
            !!file.fileId && folderCardKey(metadata.appData?.content) === CARD_IMAGE_KEY && !!metadata.payloads?.some((p) => p.key === CARD_IMAGE_KEY);
        return { name, ...(hasCard ? { cardImage: { fileId: file.fileId!, version: metadata.updated } } : {}) };
    } catch {
        return null;
    }
}

/** The payload key a folder file's content names for its card image, if any. */
function folderCardKey(raw: unknown): unknown {
    const content = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as { card?: { cardImageKey?: unknown } };
    return content.card?.cardImageKey;
}

/** A folder file's name when its content says it is shared (`isPublic`) and named. */
function sharedFolderName(raw: unknown): string | null {
    const content = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as { name?: unknown; isPublic?: unknown };
    if (content.isPublic !== true || typeof content.name !== 'string' || !content.name.trim()) return null;
    return content.name.trim().slice(0, 200);
}

/**
 * The author's shared folders (id and name), from one guest query. Null on any
 * failure, so the page falls back to the flat list.
 */
async function fetchSharedFolders(base: string, fetchImpl: typeof fetch): Promise<{ id: string; name: string }[] | null> {
    try {
        const query = new URLSearchParams({
            alias: JOURNAL_DRIVE_ALIAS,
            type: JOURNAL_DRIVE_TYPE,
            fileType: String(FOLDER_FILE_TYPE),
            fileState: '1',
            maxRecords: '100',
            includeMetadataHeader: 'true',
        });
        const res = await fetchImpl(`${base}/api/guest/v1/drive/query/batch?${query}`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(3000),
            headers: { accept: 'application/json' },
        });
        if (res.status !== 200) return null;
        const text = await res.text();
        if (text.length > MAX_QUERY_BYTES) return null;
        const results = (JSON.parse(text) as { searchResults?: unknown }).searchResults;
        if (!Array.isArray(results)) return null;
        const folders: { id: string; name: string }[] = [];
        for (const file of results as QueryFile[]) {
            try {
                const metadata = file.fileMetadata;
                const appData = metadata?.appData;
                if (!metadata || !appData || metadata.isEncrypted !== false || appData.archivalStatus === 2) continue;
                if (typeof appData.uniqueId !== 'string' || !NOTE_ID_RE.test(appData.uniqueId)) continue;
                const name = sharedFolderName(appData.content);
                if (name) folders.push({ id: appData.uniqueId.toLowerCase(), name });
            } catch {
                // A malformed folder file is skipped.
            }
        }
        return folders;
    } catch {
        return null;
    }
}

/**
 * Splits notes (newest first) into the shared folders that hold them, in the
 * folders' order, and the rest. Folders without notes are left out.
 */
export function groupNotesByFolder(
    notes: IndexNote[],
    folders: { id: string; name: string }[],
): { folders: IndexFolder[]; rest: IndexNote[] } {
    const byId = new Map<string, IndexFolder>(folders.map((folder) => [folder.id, { ...folder, notes: [] }]));
    const rest: IndexNote[] = [];
    for (const note of notes) {
        const folder = note.groupId ? byId.get(note.groupId) : undefined;
        (folder ? folder.notes : rest).push(note);
    }
    return { folders: [...byId.values()].filter((folder) => folder.notes.length > 0), rest };
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
        const [queryRes, authorName, sharedFolder, sharedFolders] = await Promise.all([
            fetchImpl(`${base}/api/guest/v1/drive/query/batch?${query}`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(3000),
                headers: { accept: 'application/json' },
            }),
            fetchAuthorName(`${base}/pub/profile`, fetchImpl),
            folderId ? fetchSharedFolder(base, folderId, fetchImpl) : undefined,
            folderId ? undefined : fetchSharedFolders(base, fetchImpl),
        ]);

        if (folderId && !sharedFolder) return null;
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
        const grouped = sharedFolders?.length ? groupNotesByFolder(notes, sharedFolders) : null;
        return {
            identity,
            authorName: authorName ?? identity,
            notes: grouped?.folders.length ? grouped.rest : notes,
            ...(grouped?.folders.length ? { folders: grouped.folders } : {}),
            ...(folderId && sharedFolder ? { folder: { id: folderId, ...sharedFolder } } : {}),
        };
    } catch {
        return null;
    }
}

const folderUrl = (origin: string, identity: string, folderId: string) => `${origin}/share/${identity}/f/${folderId}`;
const noteUrl = (origin: string, identity: string, noteId: string) => `${origin}/share/${identity}/${noteId}`;

const formatDate = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

// A folder (lucide's folder-open), drawn as a mask so it takes the muted colour in both themes.
const FOLDER_ICON = `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>',
)}")`;

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
h2{font-size:1.5rem;line-height:1.3;margin:2rem 0 .75rem;font-weight:700}
h2:first-of-type{margin-top:0}
h3{font-size:1.125rem;margin:1.5rem 0 .5rem}
.more{margin:.5rem 0 0;font-size:.875rem}
.folder{border:1px solid var(--border);border-radius:.75rem;padding:1rem 1.25rem .75rem;margin:0 0 1.25rem}
.folder-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem 1rem;padding-bottom:.75rem}
.folder h3{display:flex;align-items:center;gap:.5rem;margin:0;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:1.375rem;line-height:1.3}
.folder h3::before{content:"";flex-shrink:0;width:1.125rem;height:1.125rem;background:var(--muted);-webkit-mask:${FOLDER_ICON} center/contain no-repeat;mask:${FOLDER_ICON} center/contain no-repeat}
.folder h3 a{text-decoration:none}
.folder h3 a:hover{text-decoration:underline;text-underline-offset:4px}
.count{color:var(--muted);font-size:.875rem;white-space:nowrap}
.folder li{padding:.75rem 0}
.folder li:last-child{border-bottom:0}
.folder li a{font-size:1rem;font-weight:500}
.folder .more{margin:0;padding-top:.75rem;border-top:1px solid var(--border)}
.folder .more a{color:var(--muted);text-decoration:none}
.folder .more a:hover{color:var(--fg);text-decoration:underline;text-underline-offset:4px}
footer{border-top:1px solid var(--border);margin-top:4rem}
footer p{margin:0;padding:2rem 0;color:var(--muted);font-size:.75rem}
`;

/**
 * The author and folder pages' Content-Security-Policy, Report-Only for now (#671): no
 * script, an inline <style> and our own images. public/_headers has the app's policy,
 * but it does not apply to a Function's response.
 */
export const AUTHOR_INDEX_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The server-rendered author index page. No client JS. */
export function buildAuthorIndexHtml(index: AuthorIndex, origin: string): string {
    const { identity, authorName, notes, folder } = index;
    const pageUrl = folder ? `${origin}/share/${identity}/f/${folder.id}` : `${origin}/share/${identity}`;
    const title = folder ? folder.name : `Notes by ${authorName}`;
    const description = folder
        ? folderShareDescription(folder.name, authorName)
        : `Public notes by ${authorName}, shared with Journal`;
    // A shared folder with a drawn card shows it; every other page keeps the site banner.
    const cardImage = folder?.cardImage;
    const cardUrl = cardImage
        ? `https://${identity}/api/guest/v1/drive/files/payload?${new URLSearchParams({
              alias: JOURNAL_DRIVE_ALIAS,
              type: JOURNAL_DRIVE_TYPE,
              fileId: cardImage.fileId,
              key: CARD_IMAGE_KEY,
              ...(cardImage.version ? { v: String(cardImage.version) } : {}),
          })}`
        : undefined;
    const property = (name: string, content: string) => `<meta property="${name}" content="${escapeHtml(content)}" />`;
    const named = (name: string, content: string) => `<meta name="${name}" content="${escapeHtml(content)}" />`;

    const list = (items: IndexNote[]) =>
        `<ol>\n${items
            .map((note) => {
                const date = note.published
                    ? `<time datetime="${note.published}">${escapeHtml(formatDate(note.published))}</time>`
                    : '';
                return `<li><a href="${escapeHtml(noteUrl(origin, identity, note.noteId))}">${escapeHtml(note.title)}</a>${date}</li>`;
            })
            .join('\n')}\n</ol>`;
    const folders = index.folders ?? [];
    const allNotes = [...notes, ...folders.flatMap((f) => f.notes)];
    let body: string;
    if (folders.length) {
        const folderSections = folders
            .map((f) => {
                const url = escapeHtml(folderUrl(origin, identity, f.id));
                // A card per folder, so its name reads as the heading of the notes under it, not as one more note.
                const count = `${f.notes.length} ${f.notes.length === 1 ? 'note' : 'notes'}`;
                const more = f.notes.length > MAX_FOLDER_PAGE_NOTES ? `All ${f.notes.length} notes →` : 'Open folder →';
                return (
                    `<section class="folder">\n<div class="folder-head"><h3><a href="${url}">${escapeHtml(f.name)}</a></h3><span class="count">${count}</span></div>\n` +
                    `${list(f.notes.slice(0, MAX_FOLDER_PAGE_NOTES))}\n<p class="more"><a href="${url}">${more}</a></p>\n</section>`
                );
            })
            .join('\n');
        body = `<h2 class="serif">Folders</h2>\n${folderSections}${notes.length ? `\n<h2 class="serif">Notes</h2>\n${list(notes)}` : ''}`;
    } else {
        body = notes.length ? list(notes) : '<p class="empty">No public notes listed.</p>';
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Journal</title>
${named('description', description)}
<link rel="canonical" href="${escapeHtml(pageUrl)}" />
${allNotes.some((note) => note.indexable) ? '' : `${named('robots', 'noindex')}\n`}${property('og:type', 'website')}
${property('og:site_name', folder ? authorName : 'Journal')}
${property('og:title', title)}
${property('og:description', description)}
${property('og:url', pageUrl)}
${property('og:image', cardUrl ?? `${origin}/banner.webp`)}${cardUrl ? `\n${property('og:image:width', '1200')}\n${property('og:image:height', '630')}` : ''}
${named('twitter:card', cardUrl ? 'summary_large_image' : 'summary')}
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
${body}
</main>
<footer><div class="wrap"><p>Published by ${escapeHtml(identity)}. Content is the author's own and is not reviewed by Journal.</p></div></footer>
</body>
</html>
`;
}

/** The indexable notes as a sitemap, with each note's last change as `<lastmod>`. */
export function buildSitemapXml(index: AuthorIndex, origin: string): string {
    const folderUrls = (index.folders ?? [])
        .filter((f) => f.notes.some((note) => note.indexable))
        .map((f) => {
            const lastmod = f.notes.map((n) => n.modified ?? n.published ?? '').sort().pop();
            return `  <url><loc>${escapeHtml(folderUrl(origin, index.identity, f.id))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
        });
    const urls = [...index.notes, ...(index.folders ?? []).flatMap((f) => f.notes)]
        .filter((note) => note.indexable)
        .map((note) => {
            const lastmod = note.modified ?? note.published;
            return `  <url><loc>${escapeHtml(noteUrl(origin, index.identity, note.noteId))}</loc>${
                lastmod ? `<lastmod>${lastmod}</lastmod>` : ''
            }</url>`;
        })
        .join('\n');
    const all = [...folderUrls, urls].filter(Boolean).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all}
</urlset>
`;
}
