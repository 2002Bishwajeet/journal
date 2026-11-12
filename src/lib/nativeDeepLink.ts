/** `text` of `journal://new` is capped; longer links are ignored. */
export const MAX_DEEP_LINK_TEXT = 10_000;
/** `title` of `journal://new` is capped; longer links are ignored. */
export const MAX_DEEP_LINK_TITLE = 500;
/** `q` of `journal://search` is capped; longer links are ignored. */
export const MAX_DEEP_LINK_QUERY = 500;

export type NativeDeepLink =
    | { kind: 'note'; id: string }
    | { kind: 'today' }
    | { kind: 'new'; title: string; text: string }
    | { kind: 'search'; query: string };

// The app's id format: a GUID (getNewId from the Homebase SDK).
const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses a `journal://` link from outside the app (widgets, Spotlight, notifications,
 * another app). Accepts only `journal://note/<id>`, `journal://today`,
 * `journal://new?title=&text=` and `journal://search?q=`; anything else (another
 * scheme, an unknown host, extra path segments, a bad id, an oversize value) is null,
 * so the link is ignored. A link only says where to go: it never changes data.
 * (`journal://share/...`, `save-shared`, `open-shared` and `auth/finalize` belong to
 * `deepLinkRoute`.)
 */
export function parseNativeDeepLink(link: string): NativeDeepLink | null {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    if (url.protocol !== 'journal:' || url.username || url.password || url.port) return null;

    const rest = url.pathname.replace(/\/+$/, '');
    switch (url.host) {
        case 'note': {
            const id = rest.slice(1);
            return NOTE_ID.test(id) ? { kind: 'note', id } : null;
        }
        case 'today':
            return rest === '' ? { kind: 'today' } : null;
        case 'new': {
            if (rest !== '') return null;
            const title = url.searchParams.get('title') ?? '';
            const text = url.searchParams.get('text') ?? '';
            if (title.length > MAX_DEEP_LINK_TITLE || text.length > MAX_DEEP_LINK_TEXT) return null;
            return { kind: 'new', title, text };
        }
        case 'search': {
            if (rest !== '') return null;
            const query = url.searchParams.get('q') ?? '';
            return query.length > MAX_DEEP_LINK_QUERY ? null : { kind: 'search', query };
        }
        default:
            return null;
    }
}

/**
 * The in-app route for a parsed link. `noteFolderId` is the note's folder (the editor
 * route is `/:folderId/:noteId`). `new` opens the share-target screen, which
 * prefills the fields and saves only when the user confirms; every route here is
 * behind the AuthGuard, which keeps the URL across sign-in (#186).
 */
export function nativeDeepLinkRoute(link: NativeDeepLink, noteFolderId: string): string {
    switch (link.kind) {
        case 'note':
            return `/${noteFolderId}/${link.id}`;
        case 'today':
            return '/?action=today';
        case 'new': {
            const params = new URLSearchParams();
            if (link.title) params.set('title', link.title);
            if (link.text) params.set('text', link.text);
            const query = params.toString();
            return `/share-target${query ? `?${query}` : ''}`;
        }
        case 'search': {
            const params = new URLSearchParams({ action: 'search' });
            if (link.query) params.set('q', link.query);
            return `/?${params.toString()}`;
        }
    }
}
