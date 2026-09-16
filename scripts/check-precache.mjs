/**
 * Fails if a legacy PGlite engine asset reached the service worker precache.
 *
 * vite.config.ts excludes the v0.3/v0.4 wasm/data/initdb by EXACT hash, because
 * all three engines share the `pglite-*`, `initdb-*` and `pg_trgm.tar-*`
 * prefixes and a wildcard would drop the live engine's copies too. Those hashes
 * drift whenever the pglite-v4 dep is bumped, and nothing else notices: the
 * app still works, the precache just silently gains ~30 MB.
 *
 * Reads the real references out of the built chunks, so it keeps working when
 * the hashes change. Run after `npm run build`.
 */
import fs from 'fs';

const ASSETS = 'dist/assets';
// e.g. pglite-Da2HFqb0.wasm, initdb-Ctytb-lQ.wasm, pg_trgm.tar-3zayjqji.gz
const ASSET_REF = /[\w.]+-[\w-]{8}\.(?:wasm|data|gz)/g;
// pglite-engine is the main-thread copy of the LIVE engine: it shares the
// worker's wasm/data, which stay precached. Only the chunk itself is excluded.
const LEGACY_ASSET_OWNER = /^(?:pglite-v4|pglite-tools)-/;
const EXCLUDED_CHUNK = /^(?:pglite-v4|pglite-tools|pglite-engine)-.*\.js$/;

const refs = (file) =>
    [...fs.readFileSync(`${ASSETS}/${file}`, 'utf8').matchAll(ASSET_REF)].map((m) => m[0]);

const precached = new Set(
    [...fs.readFileSync('dist/sw.js', 'utf8').matchAll(/"url":"([^"]+)"/g)]
        .map((m) => m[1].replace(/^\//, '')),
);

const scripts = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
const legacyOwners = scripts.filter((f) => LEGACY_ASSET_OWNER.test(f));
if (!legacyOwners.length) {
    throw new Error(`no legacy pglite chunks in ${ASSETS} — did the manualChunks names change?`);
}

// Anything a non-legacy chunk also references is live and belongs in the cache.
const live = new Set(scripts.filter((f) => !LEGACY_ASSET_OWNER.test(f)).flatMap(refs));

const leaked = new Set();
for (const chunk of scripts.filter((f) => EXCLUDED_CHUNK.test(f))) {
    if (precached.has(`assets/${chunk}`)) leaked.add(chunk);
}
for (const chunk of legacyOwners) {
    for (const asset of refs(chunk)) {
        if (!live.has(asset) && precached.has(`assets/${asset}`)) {
            leaked.add(`${asset}  (referenced by ${chunk})`);
        }
    }
}

if (leaked.size) {
    console.error(
        '::error::Legacy PGlite assets entered the precache. Update the exact hashes in vite.config.ts globIgnores:\n  ' +
        [...leaked].join('\n  '),
    );
    process.exit(1);
}

// Fewer than the build's reported entry count: a few icons are listed twice
// (once via includeAssets/manifest icons, once via the glob) and dedup here.
console.log(`Legacy PGlite engines excluded. ${precached.size} unique precache URLs.`);
