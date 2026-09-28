import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// Two tabs booting at once on legacy PGlite 0.4 data: exactly one migrates
// (the Web Lock in initDatabase, #156) and both end up with the notes.

test.use({ storageState: 'e2e/fixtures/hermetic-auth.json' });

// On a CI runner the seed, the dump, the restore and the second tab's boot
// take ~30s before any assertion runs (~10s locally), so the 30s default
// ends the test mid-way. Budget for the whole two-tab migration plus a reload.
test.setTimeout(120_000);

const PGLITE_V4_DIST = path.resolve('node_modules/pglite-v4/dist');
const NOTE_TITLE = 'Legacy note e2e';
const MIGRATION_LOG = '[PGlite Migration] Legacy database detected';

// Served on a static same-origin page, never the app shell, so the app can't
// boot and migrate mid-seed. The origin check guards the real local DB.
const SEED_HTML = `<!doctype html>
<script type="module">
  if (location.origin !== 'http://127.0.0.1:4173') throw new Error('Refusing to seed ' + location.origin);
  const { PGlite } = await import('/__e2e/pglite-v4/index.js');
  const db = await PGlite.create('idb://journal-db');
  // No schema_meta; created_at is there because every real legacy DB has had
  // it since the first schema, and the app's queries read it.
  await db.exec(\`
    CREATE TABLE document_updates (id SERIAL PRIMARY KEY, doc_id UUID NOT NULL, update_blob BYTEA NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE search_index (doc_id UUID PRIMARY KEY, title TEXT NOT NULL, plain_text_content TEXT DEFAULT '', metadata JSONB NOT NULL DEFAULT '{}');
    CREATE TABLE folders (id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);
  \`);
  await db.query('INSERT INTO search_index (doc_id, title, metadata) VALUES ($1, $2, $3)', [
    '3f0c2a8e-5b1d-4c7e-9a6f-2d8b4e1c7a90',
    '${NOTE_TITLE}',
    JSON.stringify({
      folderId: '06cf9262-4eae-4276-b0d1-8ca3cf5be6f4',
      archivalStatus: 0,
      timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
    }),
  ]);
  await db.close();
  localStorage.setItem('journal-pglite-version', '0.4');
  // Production builds silence console.log unless the Homebase debug flag is
  // set (src/lib/utils/initLogging.ts), and the migration is observed through it.
  localStorage.setItem('debug', '1');
  window.__seeded = true;
</script>`;

// The note list is per folder; the seeded note lives in Main.
async function expectLegacyNote(page: Page): Promise<void> {
  await selectFolder(page, 'Main');
  // The folder's live query can take a few seconds to settle after a migration on CI.
  await expect(page.getByText(NOTE_TITLE)).toBeVisible({ timeout: 20_000 });
}

test('only one of two tabs opened at once migrates the legacy database', async ({ context }) => {
  await context.route('**/__e2e/pglite-v4/**', (route) => {
    const rest = new URL(route.request().url()).pathname.replace('/__e2e/pglite-v4/', '');
    return route.fulfill({ path: path.join(PGLITE_V4_DIST, rest) });
  });
  await context.route('**/__e2e/seed-legacy.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: SEED_HTML }),
  );

  const seed = await context.newPage();
  await seed.goto('/__e2e/seed-legacy.html');
  await assertTestOrigin(seed);
  await seed.waitForFunction(() => (window as { __seeded?: boolean }).__seeded === true, null, {
    timeout: 60_000,
  });
  await seed.close();

  const a = await context.newPage();
  const b = await context.newPage();
  const logs: string[] = [];
  for (const p of [a, b]) p.on('console', (msg) => logs.push(msg.text()));

  await Promise.all([a.goto('/'), b.goto('/')]);
  await Promise.all([a, b].map((p) => assertTestOrigin(p)));
  await Promise.all([a, b].map((p) => waitForAppReady(p)));

  expect(logs.filter((text) => text.includes(MIGRATION_LOG))).toHaveLength(1);
  for (const p of [a, b]) {
    await expect(p.getByText("Couldn't open your journal")).toHaveCount(0);
    await expectLegacyNote(p);
  }

  await b.reload();
  await assertTestOrigin(b);
  await waitForAppReady(b);
  await expectLegacyNote(b);
});
