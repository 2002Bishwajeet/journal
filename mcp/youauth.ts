import { finalizeAuthentication, getRegistrationParams } from '@homebase-id/js-lib/auth';
import { getDomainFromUrl } from '@homebase-id/js-lib/helpers';
import { JOURNAL_MCP_APP_ID, JOURNAL_MCP_APP_NAME, JOURNAL_MCP_APP_SLUG, mcpDriveRequest } from './config';

// The YouAuth steps the CLI login (mcp/login.ts) and the hosted server (mcp/hosted/app.ts) share.
// Kept apart from login.ts, which pulls in the OS keychain the hosted server has no use for.

// Same identity validation as useYouAuthAuthorization.ts's checkIdentity (src/hooks/auth/useYouAuthAuthorization.ts:107-127).
const IDENTITY_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]{2,25}(?::\d{1,5})?$/i;

/** Far more than Homebase's `{ "odinId": … }` answer. */
const IDENT_MAX_BYTES = 4096;

/** The body as text, or null past `limit` bytes (the rest is never read). */
async function readAtMost(body: ReadableStream<Uint8Array>, limit: number): Promise<string | null> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of body) {
        size += chunk.length;
        if (size > limit) return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

export async function checkIdentity(odinId: string): Promise<boolean> {
    if (!odinId) return false;
    const strippedIdentity = getDomainFromUrl(odinId) ?? '';
    if (!IDENTITY_REGEX.test(strippedIdentity)) return false;

    try {
        // Bounded: anyone can make the hosted server run this, with any address that passes the regex.
        const response = await fetch(`https://${strippedIdentity}/api/guest/v1/auth/ident`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (!response.ok || !response.body) return false;
        const text = await readAtMost(response.body, IDENT_MAX_BYTES);
        if (text === null) return false;
        const validation: unknown = JSON.parse(text);
        const odinIdField =
            typeof validation === 'object' && validation !== null && 'odinId' in validation
                ? (validation as { odinId?: unknown }).odinId
                : undefined;
        return typeof odinIdField === 'string' && odinIdField.toLowerCase() === strippedIdentity;
    } catch {
        return false;
    }
}

/** The owner's approval page for the Journal MCP app; Homebase sends the browser on to `finalizeUrl`, with `state` if given. */
export async function buildAuthUrl(identity: string, finalizeUrl: string, publicKey: CryptoKey, friendlyName: string, state?: string): Promise<string> {
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
        publicKey,
        undefined,
        friendlyName,
        state
    );

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value) searchParams.set(key, String(value));
    }
    return `https://${identity}/api/owner/v1/youauth/authorize?${searchParams.toString()}`;
}

/** The key exchange at the end of YouAuth: the app token and shared secret, from the finalize redirect's `public_key` and `salt`. */
export async function finalizeYouAuth(
    identity: string,
    privateKey: CryptoKey,
    publicKey: string,
    salt: string
): Promise<{ clientAuthToken: string; sharedSecret: string }> {
    // ponytail: the SDK's finalizeAuthentication derives the shared key via
    // window.crypto.subtle (browser-only); Node has the same Web Crypto on
    // globalThis.crypto. Drop this once the SDK uses globalThis.crypto.
    const g = globalThis as { window?: { crypto?: Crypto } };
    g.window ??= { crypto: globalThis.crypto };
    return finalizeAuthentication(identity, privateKey, publicKey, salt);
}
