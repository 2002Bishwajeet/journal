import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentialsDir } from './credentials';

// Stale-version notice (#1035). The notice comes from the last registry check, read from a
// small cache file, so startup never waits on the network; a new check runs in the
// background at most once a day. The request is a plain anonymous GET: no identity or token.
const LATEST_URL = 'https://registry.npmjs.org/journal-mcp/latest';
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

interface UpdateCache {
    checkedAt: number;
    latest?: string;
}

const cacheFile = () => join(credentialsDir(), 'update-check.json');
const disabled = () => !!process.env.JOURNAL_MCP_NO_UPDATE_CHECK;

function readCache(): UpdateCache | null {
    try {
        const parsed: unknown = JSON.parse(readFileSync(cacheFile(), 'utf8'));
        return typeof parsed === 'object' && parsed !== null && typeof (parsed as UpdateCache).checkedAt === 'number' ? (parsed as UpdateCache) : null;
    } catch {
        return null;
    }
}

function writeCache(cache: UpdateCache): void {
    try {
        mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
        writeFileSync(cacheFile(), JSON.stringify(cache));
    } catch {
        // read-only config dir: check again next start
    }
}

/** True when `a` is a newer major.minor.patch than `b`; prerelease tags are ignored. */
const isNewer = (a: string, b: string) => a.split('-')[0].localeCompare(b.split('-')[0], 'en', { numeric: true }) > 0;

/** The line to add to the server instructions when the last check found a newer version than `running`. */
export function updateNotice(running: string | undefined): string | undefined {
    if (!running || disabled()) return undefined;
    const latest = readCache()?.latest;
    if (!latest || !isNewer(latest, running)) return undefined;
    return `Journal MCP ${latest} is available (running ${running}); restart your MCP client to update.`;
}

/** Asks the npm registry for the latest version, unless opted out or checked in the last day. Never throws. */
export async function checkForUpdate(): Promise<void> {
    const cache = readCache();
    if (disabled() || (cache && Date.now() - cache.checkedAt < DAY_MS)) return;
    // Recorded before the request, so an offline machine also asks at most once a day.
    writeCache({ checkedAt: Date.now(), latest: cache?.latest });
    try {
        const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: unknown };
        if (typeof version === 'string') writeCache({ checkedAt: Date.now(), latest: version });
    } catch {
        // offline or the registry is slow: stay silent
    }
}
