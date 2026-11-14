/**
 * Builds a large Journal database on disk and measures it (#1053).
 *
 *   npx vite-node -c scripts/bench/vite.config.ts scripts/bench/seed-large-db.ts -- --notes 10000
 *
 * Options: --notes N (default 10000), --dir PATH (default ~/.cache/journal-bench/<N>), --keep (keep the
 * data directory), --max-rss-gb G (stop seeding above this process RSS, default 6).
 *
 * Each note gets a body from a mix of 70 % short (0.5-2 KB), 25 % medium (5-20 KB) and 5 % long
 * (50-150 KB), edited in 5-30 sessions spread over a year. Every session ends with a snapshot, pruned by
 * the real selectSnapshotsToPrune as of that session's date, and the note's update log ends as the single
 * compacted blob PGliteProvider.compact() leaves. Search and sync rows go through the app's own queries.
 * Trigram indexes (created on a user's first fuzzy search) are built at the end, as most accounts have them.
 * Last, the app's daily snapshot prune runs as of today, as it would on the user's next launch (#1054).
 *
 * Prints the per-table breakdown (getDatabaseBreakdown), the data directory size, how long a cold
 * PGlite.create() over that directory takes, and peak RSS, as a markdown table. The cold open runs in a
 * child process so its time and RSS are its own. Numbers come from Node's file-backed PGlite: the browser's
 * IndexedDB store loads the whole directory into memory, so the directory size is the floor there.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import * as Y from 'yjs';
import { initializeSchema, TRIGRAM_SEARCH_SQL } from '@/lib/db/schema';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { selectSnapshotsToPrune } from '@/lib/history/retention';
import { runDailySnapshotPrune } from '@/lib/history/dailyPrune';
import { PGLITE_START_PARAMS } from '@/lib/db/startParams';
import { upsertSearchIndex, saveDocumentUpdate } from '@/lib/db/queries/documents';
import { upsertSyncRecord } from '@/lib/db/queries/syncRecords';
import { getDatabaseBreakdown } from '@/lib/db/queries/diagnostics';
import { setTestDb } from '../../src/__tests__/pgliteMock';

const DAY_MS = 86_400_000;

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const notes = Number(arg('notes') ?? 10_000);
const dataDir = arg('dir') ?? path.join(homedir(), '.cache', 'journal-bench', String(notes));
const maxRssGb = Number(arg('max-rss-gb') ?? 6);

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : mb(bytes));
const peakRss = () => process.resourceUsage().maxRSS * 1024;

function dirSize(dir: string): number {
    return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
        const full = path.join(dir, entry.name);
        return sum + (entry.isDirectory() ? dirSize(full) : statSync(full).size);
    }, 0);
}

function printBreakdown(breakdown: Awaited<ReturnType<typeof getDatabaseBreakdown>>) {
    console.log('| table | size |\n| --- | --- |');
    for (const table of breakdown.tables) console.log(`| ${table.name} | ${size(table.bytes)} |`);
    console.log(`\nnotes: ${breakdown.noteCount}, snapshots: ${breakdown.snapshotCount}`);
    console.log(`per note: average ${size(breakdown.avgBytesPerNote ?? 0)}, p95 ${size(breakdown.p95BytesPerNote ?? 0)}`);
}

// ---- Cold open, run in a child process by the seeding run ----
if (flag('open-only')) {
    const started = performance.now();
    const db = await PGlite.create(dataDir, { startParams: PGLITE_START_PARAMS });
    const created = performance.now() - started;
    await initializeSchema(db);
    const ready = performance.now() - started;
    setTestDb(db);
    const breakdownStarted = performance.now();
    const breakdown = await getDatabaseBreakdown();
    console.log(
        `cold open: PGlite.create ${Math.round(created)} ms, ready after schema check ${Math.round(ready)} ms, ` +
            `breakdown query ${Math.round(performance.now() - breakdownStarted)} ms, peak RSS ${mb(peakRss())}`,
    );
    printBreakdown(breakdown);
    await db.close();
    process.exit(0);
}

// ---- Seeding ----
function mulberry32(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = mulberry32(1053);
const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

const SYLLABLES = ['ka', 'lo', 'mi', 'ren', 'tu', 'sa', 'vi', 'dor', 'an', 'el', 'por', 'qui', 'zen', 'bra', 'ful', 'gos', 'hy', 'nex', 'ob', 'wic'];
const VOCABULARY = Array.from({ length: 4000 }, () =>
    Array.from({ length: between(1, 4) }, () => SYLLABLES[between(0, SYLLABLES.length - 1)]).join(''),
);
// Word frequency is skewed, like prose: a few words are common, most are rare
const word = () => VOCABULARY[Math.floor(VOCABULARY.length * rng() ** 3)];

function text(chars: number): string {
    let out = '';
    let sentence = 0;
    while (out.length < chars) {
        const next = word();
        out += sentence === 0 ? next[0].toUpperCase() + next.slice(1) : next;
        sentence++;
        if (sentence >= between(6, 16)) {
            out += '. ';
            sentence = 0;
        } else out += ' ';
    }
    return out.slice(0, chars);
}

function bodyChars(): number {
    const roll = rng();
    if (roll < 0.7) return between(500, 2_000);
    if (roll < 0.95) return between(5_000, 20_000);
    return between(50_000, 150_000);
}

interface Snap {
    id: number;
    createdAt: Date;
    stateBlob: Uint8Array;
    stateVector: Uint8Array;
    bytes: number;
    preview: string;
    wordCount: number;
}

/** One note edited over a year: its final doc and the snapshots retention keeps. */
function simulateNote(now: number) {
    const target = bodyChars();
    const sessions = between(5, 30);
    const times = Array.from({ length: sessions }, () => now - rng() * 365 * DAY_MS).sort((a, b) => a - b);
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');
    let written = 0;
    let snaps: Snap[] = [];

    times.forEach((time, session) => {
        const goal = Math.round((target * (session + 1)) / sessions);
        doc.transact(() => {
            while (written < goal) {
                const paragraph = text(Math.min(400, goal - written));
                const element = new Y.XmlElement('paragraph');
                fragment.insert(fragment.length, [element]);
                const content = new Y.XmlText();
                element.insert(0, [content]);
                content.insert(0, paragraph);
                written += paragraph.length;
            }
            if (session > 0 && fragment.length > 0) {
                const content = (fragment.get(between(0, fragment.length - 1)) as Y.XmlElement).get(0) as Y.XmlText;
                content.insert(between(0, content.length), `${word()} `);
                if (rng() < 0.5 && content.length > 20) content.delete(between(0, content.length - 10), 5);
            }
        });
        const first = ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).toString();
        const stateBlob = Y.encodeStateAsUpdate(doc);
        const stateVector = Y.encodeStateVector(doc);
        snaps.push({
            id: session,
            createdAt: new Date(time),
            stateBlob,
            stateVector,
            bytes: stateBlob.length + stateVector.length,
            preview: first.slice(0, 200),
            wordCount: Math.round(written / 6),
        });
        // As captureSnapshot prunes at each capture, "now" being that session
        const pruned = new Set(selectSnapshotsToPrune(snaps, new Date(time)));
        snaps = snaps.filter((snap) => !pruned.has(snap.id));
    });

    const paragraphs = fragment.toArray().map((element) => ((element as Y.XmlElement).get(0) as Y.XmlText).toString());
    return {
        title: text(between(15, 60)).replace(/\.\s*$/, ''),
        plainText: paragraphs.join('\n'),
        compacted: Y.encodeStateAsUpdate(doc),
        snaps,
        modified: new Date(times[times.length - 1]).toISOString(),
        created: new Date(times[0]).toISOString(),
    };
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
const db = await PGlite.create(dataDir, { startParams: PGLITE_START_PARAMS, extensions: { pg_trgm, unaccent } });
await initializeSchema(db);
setTestDb(db);

console.log(`Seeding ${notes} notes into ${dataDir}`);
const seedStarted = performance.now();
const now = Date.now();
let snapshotRows = 0;
for (let index = 0; index < notes; index++) {
    const note = simulateNote(now);
    const docId = randomUUID();
    await upsertSearchIndex({
        docId,
        title: note.title,
        plainTextContent: note.plainText,
        metadata: {
            title: note.title,
            folderId: MAIN_FOLDER_ID,
            timestamps: { created: note.created, modified: note.modified },
            excludeFromAI: false,
        },
    });
    await saveDocumentUpdate(docId, note.compacted);
    for (const snap of note.snaps) {
        await db.query(
            `INSERT INTO document_snapshots (doc_id, state_blob, state_vector, preview, word_count, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [docId, snap.stateBlob, snap.stateVector, snap.preview, snap.wordCount, snap.createdAt],
        );
        snapshotRows++;
    }
    await upsertSyncRecord({
        localId: docId,
        entityType: 'note',
        remoteFileId: randomUUID(),
        versionTag: randomUUID(),
        lastSyncedAt: note.modified,
        syncStatus: 'synced',
        contentHash: randomBytes(32).toString('hex'),
    });

    if ((index + 1) % 500 === 0) {
        const rss = process.memoryUsage().rss;
        console.log(`  ${index + 1}/${notes} notes, ${snapshotRows} snapshots, RSS ${mb(rss)}`);
        if (rss > maxRssGb * 1024 ** 3) {
            console.error(`STOP: process RSS ${mb(rss)} passed ${maxRssGb} GB at ${index + 1} notes. Report the smaller sizes.`);
            await db.close();
            process.exit(2);
        }
    }
}
const part = (name: string) => `${name} ${mb(dirSize(path.join(dataDir, name)))}`;
const dirLine = () => `${mb(dirSize(dataDir))} (${part('base')}, ${part('pg_wal')})`;
await db.exec(TRIGRAM_SEARCH_SQL);
await db.exec('CHECKPOINT');
const seedSeconds = (performance.now() - seedStarted) / 1000;
console.log(`\nSeeded ${notes} notes in ${seedSeconds.toFixed(0)} s. Data directory: ${dirLine()}`);

// The app's daily pass (#1054) as of now: prunes notes not edited since, then VACUUM and CHECKPOINT
const pruneStarted = performance.now();
await runDailySnapshotPrune(new Date(now));
const pruneSeconds = (performance.now() - pruneStarted) / 1000;
const seedPeak = peakRss();
await db.close();

console.log(`Daily prune pass in ${pruneSeconds.toFixed(0)} s, seeding peak RSS ${mb(seedPeak)}`);
console.log(`Data directory: ${dirLine()}\n`);

const root = path.resolve(import.meta.dirname, '../..');
const child = spawnSync(
    path.join(root, 'node_modules/.bin/vite-node'),
    ['-c', path.join(root, 'scripts/bench/vite.config.ts'), import.meta.filename, '--', '--dir', dataDir, '--open-only'],
    { stdio: 'inherit' },
);
if (!flag('keep') && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
process.exit(child.status ?? 1);
