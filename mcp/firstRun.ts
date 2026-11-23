import { getDomainFromUrl } from '@homebase-id/js-lib/helpers';
import type { McpDriveDeps } from './createServer';
import type { McpCredentials } from './credentials';

export interface FirstRunDeps {
    loadCredentials(): McpCredentials | null;
    /** `journal-mcp login <identity>`: opens the approval page in the browser, then saves the credentials. */
    login(identity: string, onAuthUrl: (url: string) => void): Promise<void>;
    createDriveDeps(creds: McpCredentials): McpDriveDeps;
}

/**
 * The Claude Desktop extension's first run (#1457). Claude Desktop starts the server with the Homebase
 * address typed at install (`JOURNAL_MCP_IDENTITY`, the bundle's `user_config`). With a saved login for
 * that address the server runs as usual. Without one it starts the login itself, so no terminal is needed:
 * the approval page opens in the browser, and the credentials go to the keychain as `journal-mcp login`
 * puts them. The server connects at once either way, since Claude Desktop won't wait minutes for it.
 * Until the login is done the returned getter throws what to do, which each tool returns as its error;
 * a call after a failed or timed-out login starts a new one.
 */
export function firstRunDeps(identityInput: string, d: FirstRunDeps): () => McpDriveDeps {
    const identity = (getDomainFromUrl(identityInput) ?? identityInput).toLowerCase();
    const savedForIdentity = () => {
        const creds = d.loadCredentials();
        return creds?.identity.toLowerCase() === identity ? creds : null;
    };

    let deps: McpDriveDeps | null = null;
    let pending = false;
    let authUrl = '';
    let failure = '';

    const startLogin = () => {
        pending = true;
        authUrl = '';
        d.login(identity, (url) => (authUrl = url))
            .then(() => {
                const creds = savedForIdentity();
                if (!creds) throw new Error('no credentials were saved');
                deps = d.createDriveDeps(creds);
            })
            .catch((err: unknown) => {
                failure = err instanceof Error ? err.message : String(err);
                console.error(`Journal sign-in failed: ${failure}`);
            })
            .finally(() => (pending = false));
    };

    const saved = savedForIdentity();
    if (saved) deps = d.createDriveDeps(saved);
    else startLogin();

    return () => {
        if (deps) return deps;
        if (!pending) {
            const why = failure.replace(/\.$/, '');
            failure = '';
            startLogin();
            throw new Error(
                `Signing in to Journal as ${identity} failed: ${why}. A new sign-in has started: approve Journal MCP in the browser tab that opens, then ask again. ` +
                    'If the address is wrong, change it in Claude Desktop under Settings → Extensions → Journal.'
            );
        }
        const open = authUrl ? ` (or open ${authUrl})` : '';
        throw new Error(`Journal is not connected yet. Approve Journal MCP for ${identity} in the browser tab that opened${open}, then ask again.`);
    };
}
