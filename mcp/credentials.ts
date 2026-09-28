import { Entry } from '@napi-rs/keyring';

// One JSON blob under a single OS-keychain entry — nothing is written to disk.
const SERVICE = 'journal-mcp';
const ACCOUNT = 'default';

export interface McpCredentials {
    identity: string;
    clientAuthToken: string;
    sharedSecret: string;
}

function isMcpCredentials(value: unknown): value is McpCredentials {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.identity === 'string' &&
        typeof candidate.clientAuthToken === 'string' &&
        typeof candidate.sharedSecret === 'string'
    );
}

export function saveCredentials(creds: McpCredentials): void {
    new Entry(SERVICE, ACCOUNT).setPassword(JSON.stringify(creds));
}

export function loadCredentials(): McpCredentials | null {
    const raw = new Entry(SERVICE, ACCOUNT).getPassword();
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return isMcpCredentials(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function deleteCredentials(): void {
    new Entry(SERVICE, ACCOUNT).deletePassword();
}
