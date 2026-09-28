import * as http from 'node:http';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createEccPair, finalizeAuthentication, getRegistrationParams } from '@homebase-id/js-lib/auth';
import { getDomainFromUrl } from '@homebase-id/js-lib/helpers';
import { JOURNAL_MCP_APP_ID, JOURNAL_MCP_APP_NAME, JOURNAL_MCP_APP_SLUG, mcpDriveRequest } from './config';
import { saveCredentials } from './credentials';

// Same identity validation as useYouAuthAuthorization.ts's checkIdentity (src/hooks/auth/useYouAuthAuthorization.ts:107-127).
const IDENTITY_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]{2,25}(?::\d{1,5})?$/i;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function checkIdentity(odinId: string): Promise<boolean> {
    if (!odinId) return false;
    const strippedIdentity = getDomainFromUrl(odinId) ?? '';
    if (!IDENTITY_REGEX.test(strippedIdentity)) return false;

    try {
        const response = await fetch(`https://${strippedIdentity}/api/guest/v1/auth/ident`);
        if (!response.ok) return false;
        const validation: unknown = await response.json();
        const odinIdField =
            typeof validation === 'object' && validation !== null && 'odinId' in validation
                ? (validation as { odinId?: unknown }).odinId
                : undefined;
        return typeof odinIdField === 'string' && odinIdField.toLowerCase() === strippedIdentity;
    } catch {
        return false;
    }
}

function promptForIdentity(): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
        rl.question('Identity (e.g. you.dotyou.cloud): ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function openBrowser(url: string): void {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
        spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    } catch {
        // Ignore — the URL printed to stderr is still usable.
    }
}

/**
 * Registers the Journal MCP app on `identity` (or prompts for one) via the same
 * YouAuth flow the app uses, using a throwaway localhost HTTP server as the finalize
 * redirect target. Saves the resulting credentials to the OS keychain on success.
 */
export async function login(identityArg?: string): Promise<void> {
    const identity = getDomainFromUrl(identityArg || (await promptForIdentity())) ?? '';

    if (!(await checkIdentity(identity))) {
        throw new Error(`Not a valid Homebase identity: ${identity}`);
    }

    const eccKey = await createEccPair();

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err: Error | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            server.close();
            if (err) reject(err);
            else resolve();
        };

        const timeoutId = setTimeout(() => finish(new Error('Login timed out after 5 minutes.')), LOGIN_TIMEOUT_MS);

        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/finalize') {
                res.writeHead(404).end();
                return;
            }

            const finalizeIdentity = url.searchParams.get('identity');
            const publicKey = url.searchParams.get('public_key');
            const salt = url.searchParams.get('salt');

            (async () => {
                if (!finalizeIdentity || !publicKey || !salt) {
                    throw new Error('Callback is missing identity, public_key or salt.');
                }
                // ponytail: the SDK's finalizeAuthentication derives the shared key via
                // window.crypto.subtle (browser-only); Node has the same Web Crypto on
                // globalThis.crypto. Drop this once the SDK uses globalThis.crypto.
                const g = globalThis as { window?: { crypto?: Crypto } };
                g.window ??= { crypto: globalThis.crypto };
                const { clientAuthToken, sharedSecret } = await finalizeAuthentication(
                    finalizeIdentity,
                    eccKey.privateKey,
                    publicKey,
                    salt
                );
                saveCredentials({ identity: finalizeIdentity, clientAuthToken, sharedSecret });
                res.writeHead(200, { 'Content-Type': 'text/plain' }).end('You can close this tab.');
                finish(null);
            })().catch((err: unknown) => {
                res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Login failed. Check the terminal.');
                finish(err instanceof Error ? err : new Error(String(err)));
            });
        });

        server.on('error', (err) => finish(err));

        server.listen(0, '127.0.0.1', () => {
            (async () => {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                const finalizeUrl = `http://127.0.0.1:${port}/finalize`;

                const params = await getRegistrationParams(
                    finalizeUrl,
                    JOURNAL_MCP_APP_NAME,
                    JOURNAL_MCP_APP_ID,
                    JOURNAL_MCP_APP_SLUG,
                    undefined,
                    undefined,
                    [mcpDriveRequest],
                    undefined,
                    undefined,
                    eccKey.publicKey,
                    undefined,
                    `Journal MCP (${os.hostname()})`,
                    undefined
                );

                const searchParams = new URLSearchParams();
                for (const [key, value] of Object.entries(params)) {
                    if (value) searchParams.set(key, String(value));
                }
                const authUrl = `https://${identity}/api/owner/v1/youauth/authorize?${searchParams.toString()}`;

                console.error(`Open this URL to approve Journal MCP:\n${authUrl}\n`);
                openBrowser(authUrl);
            })().catch((err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
        });
    });

    console.error(`Logged in as ${identity}. Credentials saved to the OS keychain.`);
}
