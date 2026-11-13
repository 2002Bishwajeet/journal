/**
 * Times advancedSearch on a large Journal database (#1225).
 *
 *   ~/.claude/bin/heavy npx vite-node -c scripts/bench/vite.config.ts scripts/bench/search-bench.ts -- --notes 10000
 *
 * Options: --notes N (default 10000), --dir PATH (default ~/.cache/journal-bench/<N>, the directory
 * `seed-large-db.ts --keep` leaves), --runs R (default 20). Seeds the directory with seed-large-db.ts
 * --keep when it is missing. Adds a few fixed notes the queries need (upserted, so reruns do not add
 * more), then runs each query once to warm up and R more times, and prints p50/p95 per query.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { initializeSchema, TRIGRAM_SEARCH_SQL } from '@/lib/db/schema';
import { PGLITE_START_PARAMS } from '@/lib/db/startParams';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { upsertSearchIndex } from '@/lib/db/queries/documents';
import { advancedSearch } from '@/lib/db/queries/search';
import { runSearchReindex } from '@/lib/db/searchReindex';
import { setTestDb } from '../../src/__tests__/pgliteMock';

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}
const notes = Number(arg('notes') ?? 10_000);
const dataDir = arg('dir') ?? path.join(homedir(), '.cache', 'journal-bench', String(notes));
const runs = Number(arg('runs') ?? 20);
const root = path.resolve(import.meta.dirname, '../..');

if (!existsSync(dataDir)) {
    const seed = spawnSync(
        path.join(root, 'node_modules/.bin/vite-node'),
        ['-c', path.join(root, 'scripts/bench/vite.config.ts'), path.join(root, 'scripts/bench/seed-large-db.ts'), '--',
            '--notes', String(notes), '--dir', dataDir, '--keep'],
        { stdio: 'inherit' },
    );
    if (seed.status !== 0) process.exit(seed.status ?? 1);
}

const db = await PGlite.create(dataDir, { startParams: PGLITE_START_PARAMS, extensions: { pg_trgm, unaccent } });
await initializeSchema(db);
setTestDb(db);

// Rows written before #1229 get their accent-insensitive vector first, as the app does after boot.
const reindexStarted = performance.now();
await runSearchReindex();
console.log(`Search vector rebuild: ${Math.round(performance.now() - reindexStarted)} ms`);

const filler = 'Nothing much happened today, the weather stayed grey. '.repeat(60);
const fixed: [string, string, string][] = [
    ['00000000-0000-4000-8000-000000001225', 'The zeppelin trip to Berlin and back', `We flew the zeppelin. ${filler} A new initiative began.`],
    ['00000000-0000-4000-8000-000000001226', 'Quarterly project planning', 'Goals for the next meeting.'],
    ['00000000-0000-4000-8000-000000001227', 'Dinner', 'My garden recipe for soup.'],
    ['00000000-0000-4000-8000-000000001228', 'Growth', 'Sales grew 100% this year, see the a_b column.'],
];
const now = new Date().toISOString();
for (const [docId, title, plainTextContent] of fixed) {
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent,
        metadata: { title, folderId: MAIN_FOLDER_ID, timestamps: { created: now, modified: now }, excludeFromAI: false },
    });
}
await db.exec(TRIGRAM_SEARCH_SQL);
await db.exec('ANALYZE search_index');

// The seeded vocabulary is random syllables, so the words come from a sample of the data: the
// most common one (in almost every note) and two in about a quarter of the notes.
const { rows: sample } = await db.query<{ word: string; ndoc: number }>(
    `SELECT word, ndoc FROM ts_stat('SELECT search_vector FROM search_index LIMIT 400')
     WHERE length(word) >= 5 ORDER BY ndoc DESC`,
);
const everywhere = sample[0].word;
const [word1, word2] = sample.toSorted((a, b) => Math.abs(a.ndoc - 100) - Math.abs(b.ndoc - 100)).map((row) => row.word);

const queries: [string, string][] = [
    ['word in almost every note', everywhere],
    ['common word', word1],
    ['two common words', `${word1} ${word2}`],
    ['rare word', 'zeppelin'],
    ['no hit', 'qqqzzz'],
    ['last word partial', 'zeppelin init'],
    ['title prefix', 'quarterly proj'],
    ['typo', 'zepelin'],
    ['quoted phrase', '"garden recipe"'],
    ['partial word past its stem', 'meetin'],
    ['substring inside a word', 'eppeli'],
    ['3 characters inside a word', everywhere.slice(1, 4)],
    ['3 characters, start of a few words', 'zep'],
    ['symbols', '100%'],
];

const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM search_index');
console.log(`${count.rows[0].n} notes in ${dataDir}, ${runs} runs per query\n`);
console.log('| query | text | hits | first match | p50 | p95 |\n| --- | --- | --- | --- | --- | --- |');
const ms = (value: number) => `${Math.round(value)} ms`;
for (const [label, text] of queries) {
    const first = await advancedSearch(text);
    const times: number[] = [];
    for (let run = 0; run < runs; run++) {
        const started = performance.now();
        await advancedSearch(text);
        times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const at = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
    console.log(`| ${label} | \`${text}\` | ${first.length} | ${first[0]?.matchType ?? '-'} | ${ms(at(0.5))} | ${ms(at(0.95))} |`);
}
await db.close();
