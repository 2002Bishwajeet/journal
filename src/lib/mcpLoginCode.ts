// The code `/mcp/code` shows and `journal-mcp login --no-browser` accepts:
// base64url(JSON({ identity, public_key, salt })). Public halves only; the
// ECC private key never leaves the CLI.
export interface McpLoginCode {
    identity: string;
    public_key: string;
    salt: string;
}

const FIELDS = ['identity', 'public_key', 'salt'] as const;

export function encodeMcpLoginCode(code: McpLoginCode): string {
    const { identity, public_key, salt } = code;
    const bytes = new TextEncoder().encode(JSON.stringify({ identity, public_key, salt }));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeMcpLoginCode(input: string): McpLoginCode {
    let parsed: unknown;
    try {
        const b64 = input.trim().replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new Error('Invalid login code: not a valid base64url JSON payload');
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid login code: expected an object');
    }
    const record = parsed as Record<string, unknown>;
    for (const field of FIELDS) {
        if (typeof record[field] !== 'string' || record[field] === '') {
            throw new Error(`Invalid login code: missing ${field}`);
        }
    }
    return {
        identity: record.identity as string,
        public_key: record.public_key as string,
        salt: record.salt as string,
    };
}
