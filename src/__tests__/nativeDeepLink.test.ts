import { describe, expect, it } from 'vitest';
import {
    MAX_DEEP_LINK_TEXT,
    nativeDeepLinkRoute,
    parseNativeDeepLink,
} from '@/lib/nativeDeepLink';

const ID = '0b9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10';

describe('parseNativeDeepLink', () => {
    it.each([
        [`journal://note/${ID}`, { kind: 'note', id: ID }],
        [`journal://note/${ID}/`, { kind: 'note', id: ID }],
        [`journal://note/${ID.toUpperCase()}`, { kind: 'note', id: ID.toUpperCase() }],
        ['journal://today', { kind: 'today' }],
        ['journal://today/', { kind: 'today' }],
        ['journal://new', { kind: 'new', title: '', text: '' }],
        ['journal://new?title=Hi%20there&text=a%26b%0Aline', { kind: 'new', title: 'Hi there', text: 'a&b\nline' }],
        ['journal://search', { kind: 'search', query: '' }],
        ['journal://search?q=trip%20plans', { kind: 'search', query: 'trip plans' }],
    ])('accepts %s', (link, expected) => {
        expect(parseNativeDeepLink(link)).toEqual(expected);
    });

    it.each([
        ['an empty note id', 'journal://note/'],
        ['a missing note id', 'journal://note'],
        ['a non-id note id', 'journal://note/abc'],
        ['path traversal', 'journal://note/../../etc/passwd'],
        ['encoded path traversal', `journal://note/..%2F${ID}`],
        ['an id with a suffix', `journal://note/${ID}/edit`],
        ['an id with a trailing character', `journal://note/${ID}x`],
        ['a path on today', 'journal://today/extra'],
        ['a path on new', 'journal://new/extra'],
        ['a path on search', 'journal://search/extra'],
        ['an unknown host', 'journal://delete?id=1'],
        ['a handled-elsewhere host', `journal://share/alice.dotyou.cloud/${ID}`],
        ['the auth callback', 'journal://auth/finalize?state=%2F'],
        ['another scheme', `https://journal.cloudx.run/note/${ID}`],
        ['userinfo', `journal://user@note/${ID}`],
        ['a port', `journal://note:80/${ID}`],
        ['oversize text', `journal://new?text=${'a'.repeat(MAX_DEEP_LINK_TEXT + 1)}`],
        ['oversize title', `journal://new?title=${'a'.repeat(501)}`],
        ['oversize query', `journal://search?q=${'a'.repeat(501)}`],
        ['not a URL', 'note/abc'],
        ['an empty string', ''],
    ])('ignores %s', (_, link) => {
        expect(parseNativeDeepLink(link)).toBeNull();
    });

    it('accepts text at the cap', () => {
        const text = 'a'.repeat(MAX_DEEP_LINK_TEXT);
        expect(parseNativeDeepLink(`journal://new?text=${text}`)).toEqual({ kind: 'new', title: '', text });
    });
});

describe('nativeDeepLinkRoute', () => {
    it('routes each form to a screen that never saves by itself', () => {
        expect(nativeDeepLinkRoute({ kind: 'note', id: ID }, 'folder-1')).toBe(`/folder-1/${ID}`);
        expect(nativeDeepLinkRoute({ kind: 'today' }, 'x')).toBe('/?action=today');
        expect(nativeDeepLinkRoute({ kind: 'new', title: '', text: '' }, 'x')).toBe('/share-target');
        expect(nativeDeepLinkRoute({ kind: 'new', title: 'T', text: 'a&b' }, 'x')).toBe('/share-target?title=T&text=a%26b');
        expect(nativeDeepLinkRoute({ kind: 'search', query: '' }, 'x')).toBe('/?action=search');
        expect(nativeDeepLinkRoute({ kind: 'search', query: 'a b' }, 'x')).toBe('/?action=search&q=a+b');
    });
});
