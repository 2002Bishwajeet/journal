// @vitest-environment happy-dom
/**
 * NoteList renders rows incrementally (#154): at most PAGE (100) rows mount at first,
 * and a sentinel at the end of the list adds another page when it scrolls into view.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NoteListEntry } from '@/types';

vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({ getRoot: () => '' }) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: vi.fn() }) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ togglePin: { mutate: vi.fn() } }) }));

import NoteList from '@/components/layout/NoteList';

// IntersectionObserver stub: records observed targets so a test can "scroll" the sentinel into view.
const observed = new Set<Element>();
let ioCallback: IntersectionObserverCallback = () => {};
beforeAll(() => {
    globalThis.IntersectionObserver = class {
        constructor(cb: IntersectionObserverCallback) {
            ioCallback = cb;
        }
        observe(el: Element) {
            observed.add(el);
        }
        unobserve(el: Element) {
            observed.delete(el);
        }
        disconnect() {}
        takeRecords() {
            return [];
        }
    } as unknown as typeof IntersectionObserver;
});

const NOW = new Date().toISOString();
const OLD = '2001-01-01T00:00:00.000Z';

function makeNotes(count: number, prefix: string, opts: { pinned?: boolean; modified?: string } = {}): NoteListEntry[] {
    return Array.from({ length: count }, (_, i) => ({
        docId: `${prefix}-${i}`,
        title: `${prefix} ${String(i).padStart(4, '0')}`,
        preview: '',
        metadata: {
            title: `${prefix} ${i}`,
            folderId: 'F1',
            isPinned: opts.pinned ?? false,
            timestamps: { created: opts.modified ?? NOW, modified: opts.modified ?? NOW },
            excludeFromAI: false,
        },
    }));
}

let root: Root;
beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    observed.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
});

async function render(notes: NoteListEntry[], viewKey = 'F1') {
    await act(async () => {
        root.render(
            h(NoteList, {
                notes,
                viewKey,
                selectedNoteId: null,
                onSelectNote: () => {},
                onCreateNote: () => {},
                onDeleteNote: () => {},
                onShareNote: () => {},
            }),
        );
    });
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-row"]'));
const sentinels = () => Array.from(observed).filter((el) => el.isConnected);

async function scrollSentinelIntoView() {
    const targets = sentinels();
    expect(targets).toHaveLength(1);
    await act(async () => {
        ioCallback(
            targets.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 }) as unknown as IntersectionObserverEntry),
            {} as IntersectionObserver,
        );
    });
}

const groupHeaders = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]:not([aria-haspopup])'));

describe('NoteList incremental rendering', () => {
    it('mounts 100 rows, then 200, then all 250, and drops the sentinel when done', async () => {
        await render(makeNotes(250, 'n'));
        expect(rows()).toHaveLength(100);

        await scrollSentinelIntoView();
        expect(rows()).toHaveLength(200);

        await scrollSentinelIntoView();
        expect(rows()).toHaveLength(250);
        expect(sentinels()).toHaveLength(0);
    });

    it('renders no sentinel when every row fits the budget', async () => {
        await render(makeNotes(40, 'n'));
        expect(rows()).toHaveLength(40);
        expect(sentinels()).toHaveLength(0);
    });

    it('pinned rows render first and count toward the budget', async () => {
        await render([...makeNotes(150, 'n'), ...makeNotes(30, 'p', { pinned: true })]);
        const shown = rows();
        expect(shown).toHaveLength(100);
        expect(shown.slice(0, 30).every((r) => r.textContent?.startsWith('p '))).toBe(true);
        expect(shown.slice(30).every((r) => r.textContent?.startsWith('n '))).toBe(true);
    });

    it('a collapsed group spends none of the budget, so later groups fill it', async () => {
        await render([
            ...makeNotes(30, 'p', { pinned: true }),
            ...makeNotes(90, 'recent'),
            ...makeNotes(90, 'old', { modified: OLD }),
        ]);
        expect(rows()).toHaveLength(100);
        expect(rows().filter((r) => r.textContent?.startsWith('old '))).toHaveLength(0);

        const [, recentHeader] = groupHeaders();
        await act(async () => recentHeader.click());

        expect(rows()).toHaveLength(100);
        expect(rows().filter((r) => r.textContent?.startsWith('recent '))).toHaveLength(0);
        expect(rows().filter((r) => r.textContent?.startsWith('old '))).toHaveLength(70);
    });

    it('changing the view resets the budget to 100 and keeps collapsed groups', async () => {
        const notes = [...makeNotes(20, 'p', { pinned: true }), ...makeNotes(230, 'n')];
        await render(notes, 'F1');
        await scrollSentinelIntoView();
        expect(rows()).toHaveLength(200);

        await act(async () => groupHeaders()[0].click());
        expect(rows()).toHaveLength(200);

        await render(notes, 'F2');
        expect(rows()).toHaveLength(100);
        expect(groupHeaders()[0].getAttribute('aria-expanded')).toBe('false');
    });

    it('changing the sort resets the budget to 100', async () => {
        await render(makeNotes(250, 'n'));
        await scrollSentinelIntoView();
        expect(rows()).toHaveLength(200);

        const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Sort notes"]')!;
        await act(async () => {
            trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        const titleItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
            (el) => el.textContent === 'Title A-Z',
        )!;
        expect(titleItem).toBeTruthy();
        await act(async () => titleItem.click());

        expect(rows()).toHaveLength(100);
    });
});
