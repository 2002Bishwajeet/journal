import path from 'node:path';
import { defineConfig } from 'vite';

// Bundles the hosted MCP server (mcp/hosted/main.ts, #1505) into one file, mcp/dist/http.mjs, that runs
// with plain `node`: nothing is installed next to it.
export default defineConfig({
    root: path.resolve(import.meta.dirname, '..'),
    publicDir: false,
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, '../src'),
            '@2002bishwajeet/live-blocks': path.resolve(import.meta.dirname, '../packages/live-blocks/src'),
            'cloudflare:workers': path.resolve(import.meta.dirname, 'hosted/workers.ts'),
        },
    },
    ssr: { noExternal: true },
    build: {
        ssr: 'mcp/hosted/main.ts',
        outDir: 'mcp/dist',
        emptyOutDir: true,
        // node:sqlite, and undici 8's own floor.
        target: 'node22',
        rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'http.mjs' } },
    },
});
