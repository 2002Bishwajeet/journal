// Config for seed-large-db.ts: the app's query modules run against a PGlite the script opens itself
// (the same stand-in the tests use), not the browser singleton in src/lib/db/pglite.ts.
import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const pgliteStandIn = path.join(root, 'src/__tests__/pgliteMock.ts');

export default defineConfig({
    root,
    resolve: {
        alias: [
            { find: /^\.\.\/pglite$/, replacement: pgliteStandIn },
            { find: /^@\/lib\/db\/pglite$/, replacement: pgliteStandIn },
            { find: '@', replacement: path.join(root, 'src') },
        ],
    },
});
