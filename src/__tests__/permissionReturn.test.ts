// @vitest-environment happy-dom
/**
 * Extend-permissions page in the native app (#1386): outside the app on iOS, Android and
 * macOS, returning on a journal://permissions/return link; a web view navigation elsewhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternal, permissionReturnUrl, startPermissionGrant, type NativePlatform } from '@/lib/native';
import { deepLinkRoute } from '@/lib/deepLink';
import { permissionReturnLink, permissionReturnRoute } from '@/lib/permissionReturn';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const setPlatform = (platform: NativePlatform | null) => {
    if (platform) window.__JOURNAL_NATIVE__ = { platform, plugins: [] };
    else delete window.__JOURNAL_NATIVE__;
};

const APP_PAGE = 'http://localhost:47821/?action=collaborate&noteId=n1';
const grantUrl = (returnUrl: string) =>
    `https://alice.dotyou.cloud/owner/appupdate?appId=x&return=${encodeURIComponent(returnUrl)}`;
const GRANT_URL = grantUrl(permissionReturnLink(APP_PAGE));

const stubLocation = (extra: Record<string, unknown>) =>
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, ...extra } as unknown as Location);

afterEach(() => {
    setPlatform(null);
    invoke.mockReset();
    vi.restoreAllMocks();
});

describe('permissionReturnUrl', () => {
    it.each(['ios', 'android', 'macos'] as const)('is a journal:// link on %s', (platform) => {
        setPlatform(platform);
        expect(permissionReturnUrl(APP_PAGE)).toBe(permissionReturnLink(APP_PAGE));
        expect(permissionReturnUrl(APP_PAGE)).toMatch(/^journal:\/\/permissions\/return\?to=/);
    });

    it.each([null, 'windows', 'linux'] as const)('is the app page itself on %s', (platform) => {
        setPlatform(platform);
        expect(permissionReturnUrl(APP_PAGE)).toBe(APP_PAGE);
    });
});

describe('permissionReturnRoute', () => {
    it('round-trips the path, query and hash of the page the grant started from', () => {
        const link = permissionReturnLink('http://localhost:47821/settings?tab=diagnostics&x=1#fix');
        expect(permissionReturnRoute(link)).toBe('/settings?tab=diagnostics&x=1#fix');
        expect(deepLinkRoute(link)).toBe('/settings?tab=diagnostics&x=1#fix');
    });

    it('keeps the route when the owner console adds status=canceled', () => {
        const link = `${permissionReturnLink(APP_PAGE)}&status=canceled`;
        expect(permissionReturnRoute(link)).toBe('/?action=collaborate&noteId=n1');
    });

    it.each([
        ['another origin', 'https://evil.example/steal'],
        ['a protocol-relative URL', '//evil.example/steal'],
        ['a backslash host', '/\\evil.example'],
        ['a script URL', 'javascript:alert(1)'],
        ['a relative path', 'settings'],
        ['nothing', ''],
    ])('rejects %s', (_, to) => {
        const link = `journal://permissions/return?to=${encodeURIComponent(to)}`;
        expect(permissionReturnRoute(link)).toBeNull();
        expect(deepLinkRoute(link)).toBeNull();
    });

    it('rejects a missing target, another host or path, and other schemes', () => {
        expect(permissionReturnRoute('journal://permissions/return')).toBeNull();
        expect(permissionReturnRoute('journal://permissions/other?to=%2Fnotes')).toBeNull();
        expect(permissionReturnRoute('journal://auth/return?to=%2Fnotes')).toBeNull();
        expect(permissionReturnRoute('https://journal.cloudx.run/permissions/return?to=%2Fnotes')).toBeNull();
        expect(permissionReturnRoute('not a url')).toBeNull();
        expect(deepLinkRoute('https://journal.cloudx.run/permissions/return?to=%2Fnotes')).toBeNull();
    });
});

describe('startPermissionGrant', () => {
    it.each([
        ['android', 'plugin:browser|open_url'],
        ['macos', 'plugin:opener|open_url'],
    ] as const)('opens the page outside the app on %s', async (platform, cmd) => {
        setPlatform(platform);
        await startPermissionGrant(GRANT_URL);
        expect(invoke).toHaveBeenCalledWith(cmd, { url: GRANT_URL });
    });

    it('runs the page in an auth session on iOS and resumes at the route it returns to', async () => {
        setPlatform('ios');
        const replace = vi.fn();
        stubLocation({ replace });
        invoke.mockResolvedValue({ url: permissionReturnLink(APP_PAGE) });
        await startPermissionGrant(GRANT_URL);
        expect(invoke).toHaveBeenCalledWith('plugin:browser|authenticate', { url: GRANT_URL, callbackScheme: 'journal' });
        expect(replace).toHaveBeenCalledWith('/?action=collaborate&noteId=n1');
    });

    it('stays put on iOS when the sheet is closed or returns a foreign target', async () => {
        setPlatform('ios');
        const replace = vi.fn();
        stubLocation({ replace });
        invoke.mockResolvedValueOnce(null);
        await startPermissionGrant(GRANT_URL);
        invoke.mockResolvedValueOnce({ url: 'journal://permissions/return?to=https%3A%2F%2Fevil.example' });
        await startPermissionGrant(GRANT_URL);
        expect(replace).not.toHaveBeenCalled();
    });

    it('opens other iOS links in the browser sheet', async () => {
        setPlatform('ios');
        await openExternal('https://homebase.id/');
        expect(invoke).toHaveBeenCalledWith('plugin:browser|open_url', { url: 'https://homebase.id/' });
    });

    it.each([null, 'windows', 'linux'] as const)('navigates the web view on %s', async (platform) => {
        setPlatform(platform);
        const assign = vi.fn();
        stubLocation({ assign });
        const url = grantUrl(permissionReturnUrl(`${window.location.origin}/notes`));
        await startPermissionGrant(url);
        expect(assign).toHaveBeenCalledWith(url);
        expect(invoke).not.toHaveBeenCalled();
    });
});
