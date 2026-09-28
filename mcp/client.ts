import { DotYouClient, ApiType } from '@homebase-id/js-lib/core';
import { base64ToUint8Array } from '@homebase-id/js-lib/helpers';
import type { McpCredentials } from './credentials';

/**
 * js-lib's bundled (browser) axios uses `fetch` under Node and sends every drive upload with
 * its hard-coded `content-type: multipart/form-data` and no boundary — only in a browser does
 * it clear that header so the real one comes from the FormData body. Homebase can't parse such
 * a body and answers 500, so without this every MCP write fails. Restores the boundary the
 * body itself starts with (`--<boundary>\r\n`).
 */
export function withMultipartBoundary(fetchImpl: typeof fetch): typeof fetch {
    return async (input, init) => {
        if (!(input instanceof Request) || input.headers.get('content-type') !== 'multipart/form-data') {
            return fetchImpl(input, init);
        }
        const body = new Uint8Array(await input.arrayBuffer());
        const boundary = new TextDecoder().decode(body.subarray(2, body.indexOf(13)));
        const headers = new Headers(input.headers);
        headers.set('content-type', `multipart/form-data; boundary=${boundary}`);
        return fetchImpl(new Request(input, { headers, body }), init);
    };
}

globalThis.fetch = withMultipartBoundary(globalThis.fetch);

// Same client shape as the app's own (src/hooks/auth/useAuth.ts:57-68), built from the
// MCP app's own credentials instead of the app's localStorage session.
export function createClient(creds: McpCredentials): DotYouClient {
    return new DotYouClient({
        api: ApiType.App,
        hostIdentity: creds.identity,
        sharedSecret: base64ToUint8Array(creds.sharedSecret),
        headers: { bx0900: creds.clientAuthToken },
    });
}
