// A crawlable list of an author's indexable public notes (#515):
// /share/<identity> (HTML) and /share/<identity>/sitemap.xml.
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

export type IndexNote = { noteId: string; title: string; published?: string; modified?: string };

export type AuthorIndex = { identity: string; authorName: string; notes: IndexNote[] };

/**
 * `/share/<identity>[/]` or `/share/<identity>/sitemap.xml`. Null for any other
 * path; `identity: null` when the path has that shape but no valid identity.
 */
export function parseAuthorPath(pathname: string): { identity: string | null; kind: 'index' | 'sitemap' } | null {
    const match = /^\/share\/([^/]+)(\/|\/sitemap\.xml)?$/.exec(pathname);
    if (!match) return null;
    const kind = match[2] === '/sitemap.xml' ? 'sitemap' : 'index';
    try {
        const identity = decodeURIComponent(match[1]).toLowerCase();
        return { identity: IDENTITY_RE.test(identity) ? identity : null, kind };
    } catch {
        return { identity: null, kind };
    }
}

type QueryFile = {
    fileMetadata?: {
        created?: number;
        updated?: number;
        isEncrypted?: boolean;
        appData?: { uniqueId?: unknown; content?: unknown; userDate?: number; archivalStatus?: number };
    };
};

function toIndexNote(file: QueryFile): IndexNote | null {
    try {
        const metadata = file.fileMetadata;
        const appData = metadata?.appData;
        // The guest query only returns Anonymous files; the rest is defence in depth.
        if (!metadata || !appData || metadata.isEncrypted !== false || appData.archivalStatus === 2) return null;
        if (typeof appData.uniqueId !== 'string' || !NOTE_ID_RE.test(appData.uniqueId)) return null;
        const raw = appData.content;
        const content = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as {
            title?: unknown;
            card?: { indexable?: unknown };
        };
        if (content.card?.indexable !== true) return null;
        const title = (typeof content.title === 'string' && content.title.trim()) || 'Untitled';
        return {
            noteId: appData.uniqueId.toLowerCase(),
            title: title.slice(0, 200),
            published: isoDate(appData.userDate ?? metadata.created),
            modified: isoDate(metadata.updated),
        };
    } catch {
        return null;
    }
}

/** The author's public, indexable notes, newest first. Null on any upstream failure. */
export async function fetchAuthorIndex(
    identity: string,
    fetchImpl: typeof fetch,
    override?: string,
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
        const [queryRes, authorName] = await Promise.all([
            fetchImpl(`${base}/api/guest/v1/drive/query/batch?${query}`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(3000),
                headers: { accept: 'application/json' },
            }),
            fetchAuthorName(`${base}/pub/profile`, fetchImpl),
        ]);

        if (queryRes.status !== 200) return null;
        if (Number(queryRes.headers.get('content-length') ?? 0) > MAX_QUERY_BYTES) return null;
        const text = await queryRes.text();
        if (text.length > MAX_QUERY_BYTES) return null;
        const results = (JSON.parse(text) as { searchResults?: unknown }).searchResults;
        if (!Array.isArray(results)) return null;

        const notes = (results as QueryFile[])
            .map(toIndexNote)
            .filter((note): note is IndexNote => note !== null)
            .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
            .slice(0, MAX_INDEX_NOTES);
        return { identity, authorName: authorName ?? identity, notes };
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
    const { identity, authorName, notes } = index;
    const pageUrl = `${origin}/share/${identity}`;
    const title = `Notes by ${authorName}`;
    const description = `Public notes by ${authorName}, shared with Journal`;
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
${notes.length ? '' : `${named('robots', 'noindex')}\n`}${property('og:type', 'website')}
${property('og:site_name', 'Journal')}
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
<h1 class="serif">${escapeHtml(authorName)}</h1>
<p class="sub">Public notes by ${escapeHtml(identity)}</p>
${notes.length ? `<ol>\n${items}\n</ol>` : '<p class="empty">No public notes yet.</p>'}
</main>
<footer><div class="wrap"><p>Published by ${escapeHtml(identity)}. Content is the author's own and is not reviewed by Journal.</p></div></footer>
</body>
</html>
`;
}

/** The same notes as a sitemap, with each note's last change as `<lastmod>`. */
export function buildSitemapXml(index: AuthorIndex, origin: string): string {
    const urls = index.notes
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
