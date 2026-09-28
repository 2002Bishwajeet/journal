import { DotYouClient, ApiType } from '@homebase-id/js-lib/core';
import { base64ToUint8Array } from '@homebase-id/js-lib/helpers';
import type { McpCredentials } from './credentials';

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
