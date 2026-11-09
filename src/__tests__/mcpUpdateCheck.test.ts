import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, updateNotice } from '../../mcp/updateCheck';

describe('mcp stale-version notice', () => {
    let dir: string;
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const registry = (version: string) => vi.fn(async () => new Response(JSON.stringify({ name: 'journal-mcp', version })));

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'mcp-update-'));
        process.env.XDG_CONFIG_HOME = dir;
        delete process.env.JOURNAL_MCP_NO_UPDATE_CHECK;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        delete process.env.JOURNAL_MCP_NO_UPDATE_CHECK;
        if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = prevConfig;
        rmSync(dir, { recursive: true, force: true });
    });

    it('says nothing before any check has run', () => {
        expect(updateNotice('1.12.0')).toBeUndefined();
    });

    it('names the newer version after a check finds one', async () => {
        const fetch = registry('1.13.0');
        vi.stubGlobal('fetch', fetch);
        await checkForUpdate();
        expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/journal-mcp/latest', expect.objectContaining({ signal: expect.any(AbortSignal) }));
        // Nothing identifying goes with the request: no headers, cookies or credentials.
        expect(Object.keys((fetch.mock.calls[0] as unknown[])[1] as object)).toEqual(['signal']);
        expect(updateNotice('1.12.0')).toBe('Journal MCP 1.13.0 is available (running 1.12.0); restart your MCP client to update.');
        // Numeric, not string, comparison.
        expect(updateNotice('1.9.0')).toContain('1.13.0 is available');
    });

    it('says nothing when the running version is current or newer', async () => {
        vi.stubGlobal('fetch', registry('1.12.0'));
        await checkForUpdate();
        expect(updateNotice('1.12.0')).toBeUndefined();
        expect(updateNotice('1.12.1')).toBeUndefined();
    });

    it('ignores a prerelease placeholder as latest', async () => {
        vi.stubGlobal('fetch', registry('0.0.0-stage'));
        await checkForUpdate();
        expect(updateNotice('1.12.0')).toBeUndefined();
    });

    it('stays silent offline, and asks at most once a day', async () => {
        const offline = vi.fn(async () => {
            throw new TypeError('fetch failed');
        });
        vi.stubGlobal('fetch', offline);
        await expect(checkForUpdate()).resolves.toBeUndefined();
        expect(updateNotice('1.12.0')).toBeUndefined();

        await checkForUpdate();
        expect(offline).toHaveBeenCalledTimes(1);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
        const online = registry('1.13.0');
        vi.stubGlobal('fetch', online);
        await checkForUpdate();
        expect(online).toHaveBeenCalledTimes(1);
        expect(updateNotice('1.12.0')).toContain('1.13.0 is available');
    });

    it('keeps the last known version when a later check fails', async () => {
        vi.stubGlobal('fetch', registry('1.13.0'));
        await checkForUpdate();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
        await checkForUpdate();
        expect(updateNotice('1.12.0')).toContain('1.13.0 is available');
    });

    it('neither asks nor tells when opted out', async () => {
        vi.stubGlobal('fetch', registry('1.13.0'));
        await checkForUpdate();
        process.env.JOURNAL_MCP_NO_UPDATE_CHECK = '1';
        expect(updateNotice('1.12.0')).toBeUndefined();

        rmSync(join(dir, 'journal-mcp'), { recursive: true, force: true });
        const fetch = registry('1.13.0');
        vi.stubGlobal('fetch', fetch);
        await checkForUpdate();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('skips the check in a checkout, where no version is defined', () => {
        expect(updateNotice(undefined)).toBeUndefined();
    });
});
