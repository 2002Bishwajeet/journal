// @vitest-environment happy-dom
/**
 * Settings controls expose an accessible name and state: the theme picker is
 * a native radio group, and a SettingsRow binds its label and description to
 * its control.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import AppearanceSection from '@/components/settings/sections/AppearanceSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { Switch } from '@/components/ui/switch';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    localStorage.clear();
});

async function render(element: ReactElement) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(element); });
    return async () => {
        await act(async () => root.unmount());
        el.remove();
    };
}

describe('Settings controls', () => {
    it('renders the theme picker as a radio group with exactly one checked option', async () => {
        const cleanup = await render(h(AppearanceSection));

        expect(document.querySelector('[role="radiogroup"][aria-label="Theme"]')).not.toBeNull();
        const radios = document.querySelectorAll<HTMLInputElement>('input[type=radio][name=theme]');
        expect(radios).toHaveLength(3);
        expect([...radios].filter((r) => r.checked)).toHaveLength(1);

        await act(async () => { radios[1].click(); });
        const checked = [...document.querySelectorAll<HTMLInputElement>('input[type=radio][name=theme]')]
            .filter((r) => r.checked);
        expect(checked.map((r) => r.value)).toEqual(['dark']);

        await cleanup();
    });

    it('binds a SettingsRow label and description to its switch', async () => {
        const cleanup = await render(
            h(SettingsRow, {
                id: 'x',
                label: 'Autocomplete',
                description: 'Ghost text suggestions while typing',
                control: h(Switch, { checked: false }),
            }),
        );

        expect(document.querySelector('label[for="x"]')).not.toBeNull();
        const control = document.getElementById('x');
        expect(control?.getAttribute('role')).toBe('switch');
        expect(control?.getAttribute('aria-describedby')).toBe('x-desc');
        expect(document.getElementById('x-desc')?.textContent).toBe('Ghost text suggestions while typing');

        await cleanup();
    });
});
