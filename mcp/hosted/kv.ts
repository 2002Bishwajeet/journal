// Generic OAuth-on-Node adapter: no Journal imports, so any MCP behind mcp-gateway can copy it.
// See the gateway docs (github.com/2002Bishwajeet/mcp-gateway, docs/ARCHITECTURE.md, "Per-MCP contract").
import { DatabaseSync } from 'node:sqlite';

interface ListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string;
}

/**
 * The part of a Workers KV namespace @cloudflare/workers-oauth-provider uses, on one SQLite file:
 * get (text or json), put (expirationTtl, expiration, metadata), delete, list (prefix, limit, cursor).
 * Expired rows are hidden at once and deleted by `purgeExpired`.
 */
export function sqliteKv(file: string) {
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, metadata TEXT, expiration INTEGER)');
    const now = () => Math.floor(Date.now() / 1000);
    const LIVE = '(expiration IS NULL OR expiration > ?)';

    return {
        db,
        async get(key: string, options?: string | { type?: string }): Promise<unknown> {
            const type = typeof options === 'string' ? options : (options?.type ?? 'text');
            if (type !== 'text' && type !== 'json') throw new Error(`kv.get: type ${type} is not supported`);
            const row = db.prepare(`SELECT value FROM kv WHERE key = ? AND ${LIVE}`).get(key, now()) as { value: string } | undefined;
            if (!row) return null;
            return type === 'json' ? JSON.parse(row.value) : row.value;
        },
        async put(key: string, value: string, options: { expiration?: number; expirationTtl?: number; metadata?: unknown } = {}): Promise<void> {
            if (typeof value !== 'string') throw new Error('kv.put: only string values are supported');
            const expiration = options.expiration ?? (options.expirationTtl ? now() + options.expirationTtl : null);
            const metadata = options.metadata === undefined ? null : JSON.stringify(options.metadata);
            db.prepare('INSERT OR REPLACE INTO kv (key, value, metadata, expiration) VALUES (?, ?, ?, ?)').run(key, value, metadata, expiration);
        },
        async delete(key: string): Promise<void> {
            db.prepare('DELETE FROM kv WHERE key = ?').run(key);
        },
        async list({ prefix = '', limit = 1000, cursor }: ListOptions = {}) {
            const rows = db
                .prepare(`SELECT key, metadata, expiration FROM kv WHERE substr(key, 1, ?) = ? AND key > ? AND ${LIVE} ORDER BY key LIMIT ?`)
                .all(prefix.length, prefix, cursor ?? '', now(), limit + 1) as { key: string; metadata: string | null; expiration: number | null }[];
            const page = rows.slice(0, limit);
            const done = rows.length <= limit;
            return {
                keys: page.map((row) => ({
                    name: row.key,
                    ...(row.expiration ? { expiration: row.expiration } : {}),
                    ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
                })),
                list_complete: done,
                ...(done ? {} : { cursor: page.at(-1)!.key }),
            };
        },
        purgeExpired(): void {
            db.prepare('DELETE FROM kv WHERE expiration IS NOT NULL AND expiration <= ?').run(now());
        },
    };
}

export type SqliteKv = ReturnType<typeof sqliteKv>;
