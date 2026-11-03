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
