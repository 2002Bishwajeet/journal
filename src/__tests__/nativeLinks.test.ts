// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authCallbackUrl, externalUrl, routeExternalLinks, startSignIn, type NativePlatform } from '@/lib/native';
import { deepLinkRoute } from '@/lib/deepLink';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const setPlatform = (platform: NativePlatform | null) => {
  if (platform) window.__JOURNAL_NATIVE__ = { platform };
  else delete window.__JOURNAL_NATIVE__;
};

const click = (href: string, parent: HTMLElement = document.body) => {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  parent.appendChild(anchor);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  anchor.dispatchEvent(event);
  anchor.remove();
  return event;
};

// The dynamic import and the invoke behind it resolve over a few microtasks.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  setPlatform(null);
  invoke.mockReset();
});

describe('externalUrl', () => {
  it.each([
    ['another site', 'https://homebase.id/', 'https://homebase.id/'],
    ['plain http', 'http://example.com/a?b=1', 'http://example.com/a?b=1'],
    ['an owner console page', 'https://alice.dotyou.cloud/owner/drives', 'https://alice.dotyou.cloud/owner/drives'],
  ])('opens %s outside the web view', (_, href, url) => {
    expect(externalUrl(href)).toBe(url);
  });

  it.each([
    ['an app page', `${window.location.origin}/notes`],
    ['a relative path', '/settings'],
    ['mailto', 'mailto:someone@example.com'],
    ['a journal:// link', 'journal://share/a/b'],
    ['not a URL', 'http://'],
    ['nothing', undefined],
    [
      'a page that returns to the app',
      `https://alice.dotyou.cloud/owner/appupdate?appId=x&return=${encodeURIComponent(`${window.location.origin}/notes`)}`,
    ],
  ])('keeps %s in the web view', (_, href) => {
    expect(externalUrl(href)).toBeNull();
  });
});

describe('routeExternalLinks', () => {
  it('leaves links alone on the web', () => {
    const open = window.open;
    routeExternalLinks();
    expect(window.open).toBe(open);
    expect(click('https://homebase.id/').defaultPrevented).toBe(false);
  });

  describe('in the native app', () => {
    const open = vi.fn();
    // Installed once, like main.tsx does at startup.
    beforeAll(() => {
      window.open = open;
      setPlatform('ios');
      routeExternalLinks();
    });
    beforeEach(() => setPlatform('ios'));
    afterEach(() => open.mockReset());

    it.each([
      ['ios', 'plugin:browser|open_url'],
      ['android', 'plugin:browser|open_url'],
      ['macos', 'plugin:opener|open_url'],
      ['windows', 'plugin:opener|open_url'],
      ['linux', 'plugin:opener|open_url'],
    ] as const)('opens an external anchor through the plugin on %s', async (platform, cmd) => {
      setPlatform(platform);
      expect(click('https://homebase.id/').defaultPrevented).toBe(true);
      await flush();
      expect(invoke).toHaveBeenCalledWith(cmd, { url: 'https://homebase.id/' });
      expect(open).not.toHaveBeenCalled();
    });

    it('opens window.open of an external URL through the plugin', async () => {
      expect(window.open('https://example.com/x', '_blank', 'noopener')).toBeNull();
      await flush();
      expect(invoke).toHaveBeenCalledWith('plugin:browser|open_url', { url: 'https://example.com/x' });
      expect(open).not.toHaveBeenCalled();
    });

    it('passes an app page through to the web view', async () => {
      window.open('/notes', '_blank');
      expect(click(`${window.location.origin}/notes`).defaultPrevented).toBe(false);
      await flush();
      expect(open).toHaveBeenCalledWith('/notes', '_blank');
      expect(invoke).not.toHaveBeenCalled();
    });

    it('leaves a link in an editable note to the editor', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      document.body.appendChild(editor);
      // Not prevented: the editor's own click handler decides. (happy-dom then follows
      // the link itself, which a browser doesn't do inside contenteditable.)
      expect(click('https://homebase.id/', editor).defaultPrevented).toBe(false);
      editor.remove();
    });
  });
});

describe('sign-in', () => {
  const AUTH_URL = 'https://alice.dotyou.cloud/api/owner/v1/youauth/authorize?client_id=x';
  const CALLBACK_QUERY = '?identity=alice.dotyou.cloud&public_key=pk&salt=s&state=%2Fnotes';
  let location: { href: string; replace: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    location = { href: '', replace: vi.fn() };
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: 'http://localhost:47821',
      ...location,
    } as unknown as Location);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [null, 'http://localhost:47821/auth/finalize'],
    ['windows', 'http://localhost:47821/auth/finalize'],
    ['linux', 'http://localhost:47821/auth/finalize'],
    ['ios', 'journal://auth/finalize'],
    ['android', 'journal://auth/finalize'],
    ['macos', 'journal://auth/finalize'],
  ] as const)('returns to %s at %s', (platform, url) => {
    setPlatform(platform);
    expect(authCallbackUrl()).toBe(url);
  });

  it('navigates the web view on the web', async () => {
    const assigned: string[] = [];
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      set href(value: string) {
        assigned.push(value);
      },
    } as unknown as Location);
    await startSignIn(AUTH_URL);
    expect(assigned).toEqual([AUTH_URL]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('opens /auth/finalize with the auth session callback on iOS', async () => {
    setPlatform('ios');
    invoke.mockResolvedValue({ url: `journal://auth/finalize${CALLBACK_QUERY}` });
    await startSignIn(AUTH_URL);
    expect(invoke).toHaveBeenCalledWith('plugin:browser|authenticate', { url: AUTH_URL, callbackScheme: 'journal' });
    expect(location.replace).toHaveBeenCalledWith(`/auth/finalize${CALLBACK_QUERY}`);
  });

  it('stays on the sign-in page when the iOS sheet is closed', async () => {
    setPlatform('ios');
    invoke.mockResolvedValue(null);
    await startSignIn(AUTH_URL);
    expect(location.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['android', 'plugin:browser|open_url'],
    ['macos', 'plugin:opener|open_url'],
  ] as const)('opens the authorize page outside the app on %s; the callback is a deep link', async (platform, cmd) => {
    setPlatform(platform);
    await startSignIn(AUTH_URL);
    expect(invoke).toHaveBeenCalledWith(cmd, { url: AUTH_URL });
    expect(deepLinkRoute(`journal://auth/finalize${CALLBACK_QUERY}`)).toBe(`/auth/finalize${CALLBACK_QUERY}`);
  });
});
