// Layer 2 (#202): every context the `app`/`anonPage` fixtures open in the
// `recorded` project replays this spec's HAR of real Homebase traffic, or —
// with E2E_HAR=update (`npm run e2e:record`) — records it from a real identity.
// A replayer of recorded bytes, not a fake: no request logic, no state beyond
// the replay position. How-to: e2e/har/README.md.
import type { BrowserContext, Response, TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// = LIVE_STORAGE_STATE in ../fixtures (not imported: that module imports this one).
const LIVE_AUTH = 'e2e/.auth/live.json';

type HarHeader = { name: string; value: string };
type HarEntry = {
    startedDateTime: string;
    request: { method: string; url: string };
    response: { status: number; headers: HarHeader[]; content: { text?: string; encoding?: string } };
};
type HarLog = { log: { entries: HarEntry[] } };
type HarMeta = { identity: string; recordedAt: string; sdkVersion: string };

export interface RecordedTraffic {
    storageState: string;
    /** The identity origin, for the network fence. */
    origins: string[];
    /** Routes a freshly created context through this spec's HAR. */
    attach(context: BrowserContext): Promise<void>;
    /** Every identity response the contexts got, in order (served from the HAR on replay). */
    responses: Response[];
    /** This test's isolation folder name on the identity. */
    folderName: string;
}

// One per recording run (the project runs one worker), like liveRun's folder.
const RUN_ID = `e2e-${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}-${Math.random().toString(36).slice(2, 8)}`;

// Not forwarded: the body is already decoded, and Playwright sets the length.
const DROPPED_RESPONSE_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding']);

function readHar(file: string): HarEntry[] {
    return (JSON.parse(readFileSync(file, 'utf8')) as HarLog).log.entries;
}

function requestKey(method: string, url: string): string {
    return `${method} ${new URL(url).pathname}`;
}

function fulfillment(entry: HarEntry) {
    const headers: Record<string, string> = {};
    for (const { name, value } of entry.response.headers) {
        const key = name.toLowerCase();
        if (DROPPED_RESPONSE_HEADERS.has(key)) continue;
        headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
    }
    const { text = '', encoding } = entry.response.content;
    return { status: entry.response.status, headers, body: Buffer.from(text, encoding === 'base64' ? 'base64' : 'utf8') };
}

// The SDK encrypts most query strings and JSON bodies with a random IV, so
// exact routeFromHAR matching misses most drive calls. Whatever it misses is
// served from the same HAR by (method, path), in recorded order — the last
// recorded response repeats once a path's entries run out.
async function routeSequenceFallback(
    context: BrowserContext,
    entries: HarEntry[],
    identity: string,
    cursors: Map<string, number>,
    unmatched: string[],
): Promise<void> {
    const byKey = new Map<string, HarEntry[]>();
    for (const entry of entries) {
        const key = requestKey(entry.request.method, entry.request.url);
        byKey.set(key, [...(byKey.get(key) ?? []), entry]);
    }
    await context.route(`https://${identity}/**`, (route) => {
        const key = requestKey(route.request().method(), route.request().url());
        const recorded = byKey.get(key);
        if (!recorded) {
            unmatched.push(`HAR_UNMATCHED ${key}`);
            return route.abort('failed');
        }
        const index = cursors.get(key) ?? 0;
        cursors.set(key, index + 1);        return route.fulfill(fulfillment(recorded[Math.min(index, recorded.length - 1)]));
    });
}

// Merges the per-context recordings of one test into the spec's HAR, in request order.
function writeHar(contextFiles: string[], harFile: string): void {
    const entries = contextFiles
        .filter((file) => existsSync(file))
        .flatMap(readHar)
        .sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime));
    mkdirSync(path.dirname(harFile), { recursive: true });
    writeFileSync(harFile, `${JSON.stringify({ log: { version: '1.2', creator: { name: 'e2e:record', version: '1' }, entries } }, null, 2)}\n`);
}

/** The body of the `recordedTraffic` fixture (../fixtures.ts). */
export async function recordedTraffic(
    testInfo: TestInfo,
    appOrigin: string,
    provide: (traffic: RecordedTraffic) => Promise<void>,
): Promise<void> {
    const harDir = path.join(testInfo.project.testDir, 'har');
    const metaFile = path.join(harDir, 'meta.json');
    const relativeSpec = path.relative(testInfo.project.testDir, testInfo.file);
    const harFile = path.join(harDir, relativeSpec.replace(/\.spec\.ts$/, '.har'));
    const recording = process.env.E2E_HAR === 'update';

    let identity: string;
    if (recording) {
        if (!process.env.E2E_LIVE_IDENTITY || !existsSync(LIVE_AUTH)) {
            throw new Error(
                `npm run e2e:record needs E2E_LIVE_IDENTITY and ${LIVE_AUTH} — log in first with ` +
                'E2E_LIVE_IDENTITY=<throwaway identity> npm run e2e:login (see e2e/har/README.md).',
            );
        }
        identity = process.env.E2E_LIVE_IDENTITY;
    } else {
        if (!existsSync(metaFile) || !existsSync(harFile)) {
            throw new Error(`No recording for ${relativeSpec} — run npm run e2e:record (see e2e/har/README.md).`);
        }
        identity = (JSON.parse(readFileSync(metaFile, 'utf8')) as HarMeta).identity;
    }

    const entries = recording ? [] : readHar(harFile);
    const cursors = new Map<string, number>();
    const unmatched: string[] = [];
    const contextFiles: string[] = [];
    const responses: Response[] = [];

    await provide({
        storageState: recording ? LIVE_AUTH : (testInfo.project.use.storageState as string),
        origins: [`https://${identity}`],
        responses,
        folderName: `${RUN_ID}-${path.basename(testInfo.file, '.recorded.spec.ts')}`,
        async attach(context) {
            context.on('response', (response) => {
                if (new URL(response.url()).host === identity) responses.push(response);
            });
            // HAR can't replay websockets; realtime flows are layer 3 (*.live.spec.ts).
            await context.routeWebSocket(`wss://${identity}/**`, (ws) => ws.close());
            if (recording) {
                const file = testInfo.outputPath(`context-${contextFiles.length}.har`);
                contextFiles.push(file);
                await context.routeFromHAR(file, {
                    update: true, updateContent: 'embed', updateMode: 'minimal', url: `https://${identity}/**`,
                });
                return;
            }
            // Routes registered later run first: exact HAR match, then the sequence fallback.
            await routeSequenceFallback(context, entries, identity, cursors, unmatched);
            await context.routeFromHAR(harFile, { url: `https://${identity}/**`, notFound: 'fallback' });
        },
    });

    if (unmatched.length > 0) {
        throw new Error(`${unmatched.join('\n')}\nRe-record: npm run e2e:record (see e2e/har/README.md).`);
    }
    // The fixtures close every context before this runs, which is when the recordings are written.
    if (recording && testInfo.status === testInfo.expectedStatus) {
        writeHar(contextFiles, harFile);
        const live = JSON.parse(readFileSync(LIVE_AUTH, 'utf8')) as { origins: { origin: string }[] };
        const replayAuth = { cookies: [], origins: live.origins.filter((o) => o.origin === appOrigin) };
        writeFileSync(path.join(harDir, 'replay-auth.json'), `${JSON.stringify(replayAuth, null, 2)}\n`);
        const sdk = path.resolve(testInfo.project.testDir, '../node_modules/@homebase-id/js-lib/package.json');
        const meta: HarMeta = {
            identity,
            recordedAt: new Date().toISOString(),
            sdkVersion: (JSON.parse(readFileSync(sdk, 'utf8')) as { version: string }).version,
        };
        writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    }
}
