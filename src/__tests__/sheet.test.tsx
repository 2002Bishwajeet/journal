// @vitest-environment happy-dom
/** #823: the bottom and full sheets, the action sheet, and the pick between sheet and dialog. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pencil, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ActionSheet } from '@/components/ui/action-sheet';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { followKeyboardBottom } from '@/lib/keyboardViewport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

async function mount(node: ReactElement) {
    await act(async () => root.render(node));
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

function sampleSheet(variant: 'bottom' | 'full', onOpenChange: (open: boolean) => void) {
    return createElement(
        Sheet,
        { open: true, onOpenChange },
        createElement(
            SheetContent,
            { variant },
            createElement(
                SheetHeader,
                null,
                createElement(SheetTitle, null, 'Pick a folder'),
                createElement(SheetDescription, null, 'Choose one.'),
            ),
        ),
    );
}

describe('Sheet', () => {
    it.each(['bottom', 'full'] as const)('focuses the %s sheet itself on open, not its first button', async (variant) => {
        await mount(sampleSheet(variant, vi.fn()));
        await act(async () => new Promise((r) => setTimeout(r, 0)));
        expect(document.activeElement).toBe(dialog());
    });

    it.each(['bottom', 'full'] as const)('names the %s sheet dialog from its title', async (variant) => {
        await mount(sampleSheet(variant, vi.fn()));
        const el = dialog()!;
        expect(el).not.toBeNull();
        const labelledBy = el.getAttribute('aria-labelledby')!;
        expect(document.getElementById(labelledBy)?.textContent).toBe('Pick a folder');
        expect(el.dataset.variant).toBe(variant);
    });

    it('shows a grabber on a bottom sheet and a close button on a full sheet', async () => {
        await mount(sampleSheet('bottom', vi.fn()));
        expect(document.querySelector('[data-slot="sheet-grabber"]')).not.toBeNull();
        expect(document.querySelector('[data-slot="sheet-close"]')).toBeNull();
        await mount(sampleSheet('full', vi.fn()));
        expect(document.querySelector('[data-slot="sheet-grabber"]')).toBeNull();
        expect(document.querySelector('[data-slot="sheet-close"]')).not.toBeNull();
    });

    it('asks to close on Escape', async () => {
        const onOpenChange = vi.fn();
        await mount(sampleSheet('bottom', onOpenChange));
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('asks to close from the close button', async () => {
        const onOpenChange = vi.fn();
        await mount(sampleSheet('full', onOpenChange));
        await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click());
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

describe('ActionSheet', () => {
    const items = () => [
        { label: 'Rename', icon: Pencil, action: vi.fn() },
        { label: 'Delete', icon: Trash2, action: vi.fn(), variant: 'destructive' as const },
    ];

    it('lists the items as menu items, destructive ones in their own group, and Cancel last', async () => {
        await mount(createElement(ActionSheet, { open: true, onOpenChange: vi.fn(), title: 'Note actions', items: items() }));
        const menu = document.querySelector('[role="menu"]')!;
        expect(menu.getAttribute('aria-label')).toBe('Note actions');
        expect([...menu.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Rename', 'Delete']);
        const groups = menu.querySelectorAll('[role="group"]');
        expect(groups).toHaveLength(2);
        expect(groups[1].textContent).toBe('Delete');
        expect(groups[1].querySelector('button')!.className).toContain('text-destructive');

        const buttons = [...dialog()!.querySelectorAll('button')];
        expect(buttons[buttons.length - 1].textContent).toBe('Cancel');
        expect(buttons[buttons.length - 1].getAttribute('role')).toBeNull();
    });

    it('runs the action, then closes', async () => {
        const onOpenChange = vi.fn();
        const list = items();
        await mount(createElement(ActionSheet, { open: true, onOpenChange, title: 'Note actions', items: list }));
        await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
        expect(list[0].action).toHaveBeenCalledOnce();
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes from Cancel without running an action', async () => {
        const onOpenChange = vi.fn();
        const list = items();
        await mount(createElement(ActionSheet, { open: true, onOpenChange, title: 'Note actions', items: list }));
        const buttons = [...dialog()!.querySelectorAll('button')];
        await act(async () => buttons[buttons.length - 1].click());
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(list[0].action).not.toHaveBeenCalled();
    });
});

describe('ResponsiveSheet', () => {
    const stubMedia = (matches: boolean) =>
        vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const sample = () =>
        createElement(ResponsiveSheet, { open: true, onOpenChange: vi.fn(), title: 'Move', variant: 'bottom', children: 'Body' });

    it('renders a sheet on a phone', async () => {
        stubMedia(true);
        await mount(sample());
        expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
        expect(document.querySelector('[data-slot="sheet-body"]')!.textContent).toBe('Body');
    });

    it('renders the dialog on desktop', async () => {
        stubMedia(false);
        await mount(sample());
        expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
        expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
    });
});

describe('followKeyboardBottom', () => {
    function stubViewport(vv: { height: number; offsetTop: number; scale: number }) {
        const listeners = new Set<() => void>();
        const viewport = {
            ...vv,
            addEventListener: (_: string, fn: () => void) => listeners.add(fn),
            removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        };
        vi.stubGlobal('visualViewport', viewport);
        vi.stubGlobal('innerHeight', 800);
        return { viewport, fire: () => listeners.forEach((fn) => fn()) };
    }

    it('lifts the sheet onto the keyboard and drops it when the keyboard goes', () => {
        const { viewport, fire } = stubViewport({ height: 500, offsetTop: 0, scale: 1 });
        const el = document.createElement('div');
        const cleanup = followKeyboardBottom(el)!;
        expect(el.style.getPropertyValue('--sheet-bottom')).toBe('300px');
        expect(el.style.getPropertyValue('--sheet-h')).toBe('500px');

        viewport.height = 800;
        fire();
        expect(el.style.getPropertyValue('--sheet-bottom')).toBe('');
        expect(el.style.getPropertyValue('--sheet-h')).toBe('');
        cleanup();
    });

    it('counts the visual viewport offset when the page is scrolled behind the keyboard', () => {
        stubViewport({ height: 500, offsetTop: 100, scale: 1 });
        const el = document.createElement('div');
        followKeyboardBottom(el);
        expect(el.style.getPropertyValue('--sheet-bottom')).toBe('200px');
    });

    it('ignores a pinch zoom', () => {
        stubViewport({ height: 400, offsetTop: 0, scale: 2 });
        const el = document.createElement('div');
        followKeyboardBottom(el);
        expect(el.style.getPropertyValue('--sheet-bottom')).toBe('');
    });
});
