import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Entry } from '@napi-rs/keyring';

// One JSON blob under a single OS-keychain entry. When the keyring is unavailable
// (headless Linux without Secret Service), fall back to a 0600 file in the config dir.
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

function credentialsDir(): string {
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'journal-mcp');
}

function credentialsFile(): string {
    return join(credentialsDir(), 'credentials.json');
}

function parseCredentials(raw: string | null | undefined): McpCredentials | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return isMcpCredentials(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Saves credentials and returns where they went, for user-facing messages. */
export function saveCredentials(creds: McpCredentials): string {
    const json = JSON.stringify(creds);
    try {
        new Entry(SERVICE, ACCOUNT).setPassword(json);
        return 'the OS keychain';
    } catch {
        const dir = credentialsDir();
        const file = credentialsFile();
        const tmp = `${file}.${process.pid}.tmp`;
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        writeFileSync(tmp, json, { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, file);
        return file;
    }
}

export function loadCredentials(): McpCredentials | null {
    try {
        const fromKeyring = parseCredentials(new Entry(SERVICE, ACCOUNT).getPassword());
        if (fromKeyring) return fromKeyring;
    } catch {
        // keyring unavailable; try the file
    }
    try {
        return parseCredentials(readFileSync(credentialsFile(), 'utf8'));
    } catch {
        return null;
    }
}

export function deleteCredentials(): void {
    try {
        new Entry(SERVICE, ACCOUNT).deletePassword();
    } catch {
        // keyring unavailable or no entry
    }
    rmSync(credentialsFile(), { force: true });
}
