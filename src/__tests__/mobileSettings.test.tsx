// @vitest-environment happy-dom
/**
 * Phone Settings (#831): a grouped section list with value hints; a section page has a
 * "Settings" back button; the list has Done.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/components/ui/dialog', () => ({ DialogTitle: ({ children }: { children: string }) => <h2>{children}</h2> }));
vi.mock('@/hooks/useAccountSettings', () => ({ useAccountSettings: () => ({ identity: 'me.example.com' }) }));
vi.stubGlobal('__APP_VERSION__', '1.2.3');
vi.mock('@/hooks/useThemePreference', () => ({ useThemePreference: () => ({ theme: 'dark' }) }));

const { default: MobileSettings } = await import('@/components/settings/MobileSettings');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sections = ['account', 'appearance', 'about'].map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  description: '',
  icon: () => null,
  Component: () => <p>{id} page</p>,
})) as never;

let container: HTMLElement;
let root: Root;
const onPage = vi.fn();
const onClose = vi.fn();

const render = (page: string | null) =>
  act(async () => root.render(<MobileSettings sections={sections} page={page as never} onPage={onPage} onClose={onClose} />));
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;

beforeEach(() => {
  onPage.mockClear();
  onClose.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('MobileSettings', () => {
  it('lists every section in groups with value hints, and Done closes', async () => {
    await render(null);
    expect(container.querySelectorAll('ul')).toHaveLength(3);
    expect(container.querySelectorAll('li button')).toHaveLength(3);
    expect(container.textContent).toContain('me.example.com');
    expect(container.textContent).toContain('Dark');

    await act(async () => button('Appearance').click());
    expect(onPage).toHaveBeenCalledWith('appearance');
    await act(async () => button('Done').click());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the section page with a Settings back button', async () => {
    await render('appearance');
    expect(container.querySelector('[role=region]')?.textContent).toBe('appearance page');
    expect(container.querySelector('ul')).toBeNull();

    await act(async () => button('Settings').click());
    expect(onPage).toHaveBeenCalledWith(null);
  });
});

describe('MobileSettings groups (#1182)', () => {
  it('puts agent access under a "Privacy & agents" label, hides diagnostics from the list and links it under About', async () => {
    const all = ['account', 'agent-access', 'about', 'diagnostics'].map((id) => ({
      id, label: id, description: '', icon: () => null, Component: () => <p>{id} page</p>,
    })) as never;
    await act(async () => root.render(<MobileSettings sections={all} page={'about' as never} onPage={onPage} onClose={onClose} />));
    expect(container.textContent).toContain('about page');
    await act(async () => button('Troubleshooting').click());
    expect(onPage).toHaveBeenCalledWith('diagnostics');

    await act(async () => root.render(<MobileSettings sections={all} page={null} onPage={onPage} onClose={onClose} />));
    expect(container.querySelector('h3')?.textContent).toBe('Privacy & agents');
    expect(button('agent-access')).toBeDefined();
    expect(container.textContent).toContain('v1.2.3');
    expect(container.textContent).not.toContain('diagnostics');
  });
});

describe('MobileSettings on Android (#1182)', () => {
  afterEach(() => {
    window.__JOURNAL_NATIVE__ = undefined;
  });

  it('draws full-width rows instead of inset cards', async () => {
    await render(null);
    expect(container.querySelector('ul')?.className).toContain('rounded-xl');
    window.__JOURNAL_NATIVE__ = { platform: 'android' };
    await render(null);
    const list = container.querySelector('ul')!;
    expect(list.className).not.toContain('rounded-xl');
    expect(list.className).toContain('-mx-5');
  });
});
