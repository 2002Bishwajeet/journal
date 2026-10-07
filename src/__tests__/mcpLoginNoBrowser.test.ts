import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeMcpLoginCode } from '@/lib/mcpLoginCode';

const mocks = vi.hoisted(() => ({
    answer: '',
    getRegistrationParams: vi.fn(),
    finalizeAuthentication: vi.fn(),
    saveCredentials: vi.fn(),
    createServer: vi.fn(),
    spawn: vi.fn(),
}));

vi.mock('@homebase-id/js-lib/auth', () => ({
    createEccPair: async () => ({ privateKey: 'PRIV', publicKey: 'PUB' }),
    getRegistrationParams: mocks.getRegistrationParams,
    finalizeAuthentication: mocks.finalizeAuthentication,
}));
vi.mock('../../mcp/credentials', () => ({ saveCredentials: mocks.saveCredentials }));
vi.mock('node:http', () => ({ createServer: mocks.createServer }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:readline', () => ({
    createInterface: () => ({
        on: vi.fn(),
        close: vi.fn(),
        question: (_q: string, cb: (a: string) => void) => cb(mocks.answer),
    }),
}));

import { login } from '../../mcp/login';

const IDENTITY = 'me.dotyou.cloud';
const HINT = 'Over SSH? Re-run with --no-browser.';

const validCode = () => encodeMcpLoginCode({ identity: IDENTITY, public_key: 'server-pub', salt: 'the-salt' });

describe('journal-mcp login --no-browser', () => {
    let stderr: ReturnType<typeof vi.spyOn>;
    const env = { ...process.env };

    beforeEach(() => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, json: async () => ({ odinId: IDENTITY }) }))
        );
        mocks.getRegistrationParams.mockImplementation(async (finalizeUrl: string) => ({ return_url: finalizeUrl }));
        mocks.finalizeAuthentication.mockResolvedValue({ clientAuthToken: 'tok', sharedSecret: 'sec' });
        mocks.saveCredentials.mockReturnValue('the OS keychain');
        stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
        delete process.env.JOURNAL_MCP_APP_ORIGIN;
        delete process.env.SSH_CONNECTION;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        process.env = { ...env };
    });

    it('redirects to <origin>/mcp/code, starts no server and finalizes the pasted code', async () => {
        mocks.answer = validCode();

        await login(IDENTITY, { noBrowser: true });

        expect(mocks.getRegistrationParams.mock.calls[0][0]).toBe('https://journal.cloudx.run/mcp/code');
        const printed = stderr.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
        expect(printed).toContain(`https://${IDENTITY}/api/owner/v1/youauth/authorize?`);
        expect(printed).toContain(encodeURIComponent('https://journal.cloudx.run/mcp/code'));
        expect(mocks.createServer).not.toHaveBeenCalled();
        expect(mocks.spawn).not.toHaveBeenCalled();
        expect(mocks.finalizeAuthentication).toHaveBeenCalledWith(IDENTITY, 'PRIV', 'server-pub', 'the-salt');
        expect(mocks.saveCredentials).toHaveBeenCalledWith({ identity: IDENTITY, clientAuthToken: 'tok', sharedSecret: 'sec' });
    });

    it('honours JOURNAL_MCP_APP_ORIGIN', async () => {
        process.env.JOURNAL_MCP_APP_ORIGIN = 'https://dev.example.test:5173/';
        mocks.answer = validCode();

        await login(IDENTITY, { noBrowser: true });

        expect(mocks.getRegistrationParams.mock.calls[0][0]).toBe('https://dev.example.test:5173/mcp/code');
    });

    it('gives a clear error for a malformed pasted code', async () => {
        mocks.answer = 'not a code!!';

        await expect(login(IDENTITY, { noBrowser: true })).rejects.toThrow(/Invalid login code/);
        expect(mocks.finalizeAuthentication).not.toHaveBeenCalled();
        expect(mocks.saveCredentials).not.toHaveBeenCalled();
    });

    it('rejects a code issued for a different identity', async () => {
        mocks.answer = encodeMcpLoginCode({ identity: 'other.dotyou.cloud', public_key: 'p', salt: 's' });

        await expect(login(IDENTITY, { noBrowser: true })).rejects.toThrow(/other\.dotyou\.cloud/);
        expect(mocks.finalizeAuthentication).not.toHaveBeenCalled();
    });

    it('prints the --no-browser hint over SSH, but not when --no-browser was passed', async () => {
        process.env.SSH_CONNECTION = '1.2.3.4 22 5.6.7.8 22';
        mocks.createServer.mockImplementation(() => {
            throw new Error('stop: server flow reached');
        });

        await expect(login(IDENTITY)).rejects.toThrow('server flow reached');
        expect(stderr.mock.calls.map((c: unknown[]) => String(c[0]))).toContain(HINT);

        stderr.mockClear();
        mocks.answer = validCode();
        await login(IDENTITY, { noBrowser: true });
        expect(stderr.mock.calls.map((c: unknown[]) => String(c[0]))).not.toContain(HINT);
    });
});
