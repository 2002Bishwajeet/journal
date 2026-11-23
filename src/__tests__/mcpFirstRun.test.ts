import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer, type McpDriveDeps } from '../../mcp/createServer';
import type { McpCredentials } from '../../mcp/credentials';
import { firstRunDeps, type FirstRunDeps } from '../../mcp/firstRun';
import { mcpbManifest } from '../../mcp/mcpb';

const IDENTITY = 'alex.dotyou.cloud';
const CREDS: McpCredentials = { identity: IDENTITY, clientAuthToken: 'tok', sharedSecret: 'sec' };
const DEPS = { listFolders: async () => [] } as unknown as McpDriveDeps;

/** Lets the login's .then/.catch/.finally run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakes(saved: McpCredentials | null) {
    let finishLogin: (err?: Error) => void = () => {};
    const d = {
        loadCredentials: vi.fn(() => saved),
        login: vi.fn(
            (_identity: string, onAuthUrl: (url: string) => void) =>
                new Promise<void>((resolve, reject) => {
                    onAuthUrl('https://alex.dotyou.cloud/api/owner/v1/youauth/authorize?x=1');
                    finishLogin = (err) => {
                        if (err) return reject(err);
                        saved = CREDS;
                        resolve();
                    };
                })
        ),
        createDriveDeps: vi.fn(() => DEPS),
    } satisfies FirstRunDeps;
    return { d, finishLogin: (err?: Error) => finishLogin(err) };
}

describe('Claude Desktop extension first run (#1457)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('uses the saved login for the address and starts no approval', () => {
        const { d } = fakes(CREDS);
        const deps = firstRunDeps(IDENTITY, d);

        expect(d.login).not.toHaveBeenCalled();
        expect(d.createDriveDeps).toHaveBeenCalledWith(CREDS);
        expect(deps()).toBe(DEPS);
    });

    it('matches the saved login however the address was typed', () => {
        const { d } = fakes(CREDS);
        firstRunDeps('https://Alex.dotyou.cloud/', d);
        expect(d.login).not.toHaveBeenCalled();
    });

    it('with no saved login, starts the browser approval and tells the tools to wait for it', async () => {
        const { d, finishLogin } = fakes(null);
        const deps = firstRunDeps(IDENTITY, d);

        expect(d.login).toHaveBeenCalledWith(IDENTITY, expect.any(Function));
        expect(() => deps()).toThrow(/Approve Journal MCP for alex\.dotyou\.cloud in the browser tab that opened \(or open https:\/\/alex\.dotyou\.cloud\/api\/owner/);

        finishLogin();
        await settle();

        expect(d.createDriveDeps).toHaveBeenCalledWith(CREDS);
        expect(deps()).toBe(DEPS);
        expect(d.login).toHaveBeenCalledTimes(1);
    });

    it('signs in again when the saved login is for another address', () => {
        const { d } = fakes({ ...CREDS, identity: 'someone.else.cloud' });
        firstRunDeps(IDENTITY, d);
        expect(d.login).toHaveBeenCalledWith(IDENTITY, expect.any(Function));
    });

    it('after a failed approval, the next tool call says why and starts a new one', async () => {
        const { d, finishLogin } = fakes(null);
        const deps = firstRunDeps(IDENTITY, d);
        finishLogin(new Error('Login timed out after 5 minutes.'));
        await settle();

        expect(() => deps()).toThrow(/failed: Login timed out after 5 minutes\. A new sign-in has started/);
        expect(d.login).toHaveBeenCalledTimes(2);
        expect(() => deps()).toThrow(/Journal is not connected yet/);
        expect(d.login).toHaveBeenCalledTimes(2);
    });

    it('the server connects before the login is done and returns the wait as a tool error', async () => {
        const { d } = fakes(null);
        const server = createJournalMcpServer(firstRunDeps(IDENTITY, d));
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'first-run', version: '0' });
        await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

        const result = await client.callTool({ name: 'list_folders', arguments: {} });
        await client.close();

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Journal is not connected yet');
    });
});

describe('Claude Desktop extension manifest (#1457)', () => {
    const manifest = mcpbManifest('1.2.3', [{ name: 'list_folders', description: 'Lists folders. More.' }]);

    it('starts the bundled server with the Homebase address typed at install', () => {
        expect(manifest.server.mcp_config.args).toEqual([`\${__dirname}/${manifest.server.entry_point}`]);
        expect(manifest.server.mcp_config.env.JOURNAL_MCP_IDENTITY).toBe('${user_config.identity}');
        expect(manifest.user_config.identity.required).toBe(true);
    });

    it('carries the version and each tool with its first sentence', () => {
        expect(manifest.version).toBe('1.2.3');
        expect(manifest.tools).toEqual([{ name: 'list_folders', description: 'Lists folders.' }]);
    });
});
