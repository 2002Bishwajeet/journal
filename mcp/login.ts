import * as http from 'node:http';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createEccPair } from '@homebase-id/js-lib/auth';
import { getDomainFromUrl } from '@homebase-id/js-lib/helpers';
import { appOrigin } from './config';
import { saveCredentials } from './credentials';
import { buildAuthUrl, checkIdentity, finalizeYouAuth } from './youauth';
import { decodeMcpLoginCode } from '@/lib/mcpLoginCode';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const NO_BROWSER_HINT = 'Over SSH? Re-run with --no-browser.';
const friendlyName = () => `Journal MCP (${os.hostname()})`;

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
    // Windows: rundll32 opens the default browser without a shell, which would split the URL at its `&`s.
    const [cmd, ...args] =
        process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler'] : ['xdg-open'];
    try {
        // A missing command fails as an 'error' event, which would end the process (the MCP server too, #1457).
        spawn(cmd, [...args, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch {
        // Ignore — the URL printed to stderr is still usable.
    }
}

function looksHeadless(env: NodeJS.ProcessEnv): boolean {
    return Boolean(env.SSH_CONNECTION) || (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);
}

async function finalizeAndSave(
    privateKey: CryptoKey,
    identity: string,
    publicKey: string,
    salt: string
): Promise<string> {
    const { clientAuthToken, sharedSecret } = await finalizeYouAuth(identity, privateKey, publicKey, salt);
    return saveCredentials({ identity, clientAuthToken, sharedSecret });
}

/** Prompts for the code `/mcp/code` shows; rejects on stdin EOF or after the login timeout. */
function promptForCode(): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            rl.close();
            reject(new Error('Login timed out after 5 minutes.'));
        }, LOGIN_TIMEOUT_MS);
        rl.on('close', () => {
            clearTimeout(timeoutId);
            reject(new Error('Input closed before a code was pasted.'));
        });
        rl.question('Paste code: ', (answer) => {
            clearTimeout(timeoutId);
            resolve(answer);
            rl.close();
        });
    });
}

async function loginWithPastedCode(identity: string, eccKey: Awaited<ReturnType<typeof createEccPair>>): Promise<string> {
    const authUrl = await buildAuthUrl(identity, `${appOrigin()}/mcp/code`, eccKey.publicKey, friendlyName());
    console.error(
        `Open this URL in any browser to approve Journal MCP, then paste the code it shows:\n${authUrl}\n`
    );

    const code = decodeMcpLoginCode(await promptForCode());
    if (code.identity.toLowerCase() !== identity.toLowerCase()) {
        throw new Error(`Login code is for ${code.identity}, not ${identity}.`);
    }
    return finalizeAndSave(eccKey.privateKey, code.identity, code.public_key, code.salt);
}

/**
 * Registers the Journal MCP app on `identity` (or prompts for one) via the same
 * YouAuth flow the app uses, using a throwaway localhost HTTP server as the finalize
 * redirect target. Saves the resulting credentials to the OS keychain (or a 0600 file) on success.
 *
 * `onAuthUrl` gets the approval URL too (the Desktop Extension shows it in Claude, #1457).
 *
 * With `noBrowser` (SSH / headless), no server is started: the finalize redirect is the
 * app's `/mcp/code` page, which shows a code the user pastes back into the terminal.
 */
export async function login(
    identityArg?: string,
    { noBrowser = false, onAuthUrl }: { noBrowser?: boolean; onAuthUrl?: (url: string) => void } = {}
): Promise<void> {
    if (!noBrowser && looksHeadless(process.env)) console.error(NO_BROWSER_HINT);

    const identity = getDomainFromUrl(identityArg || (await promptForIdentity())) ?? '';

    if (!(await checkIdentity(identity))) {
        throw new Error(`Not a valid Homebase identity: ${identity}`);
    }

    const eccKey = await createEccPair();

    if (noBrowser) {
        const savedTo = await loginWithPastedCode(identity, eccKey);
        console.error(`Logged in as ${identity}. Credentials saved to ${savedTo}.`);
        return;
    }

    let savedTo = '';
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
                savedTo = await finalizeAndSave(eccKey.privateKey, finalizeIdentity, publicKey, salt);
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

                const authUrl = await buildAuthUrl(identity, finalizeUrl, eccKey.publicKey, friendlyName());

                console.error(`Open this URL to approve Journal MCP:\n${authUrl}\n`);
                onAuthUrl?.(authUrl);
                openBrowser(authUrl);
            })().catch((err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
        });
    });

    console.error(`Logged in as ${identity}. Credentials saved to ${savedTo}.`);
}
