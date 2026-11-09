import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package/package.json'), 'utf8'));

// Bundles the MCP server into one file for the `journal-mcp` package the Claude Code
// plugin runs via npx. Everything is inlined except the native keychain module, which
// npm installs per platform from the package's dependencies.
export default defineConfig({
    root: path.resolve(import.meta.dirname, '..'),
    publicDir: false,
    // The running version, for the stale-version notice (mcp/updateCheck.ts).
    define: { 'process.env.JOURNAL_MCP_VERSION': JSON.stringify(version) },
    resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
    ssr: { noExternal: true, external: ['@napi-rs/keyring'] },
    build: {
        ssr: 'mcp/server.ts',
        outDir: 'mcp/package/dist',
        emptyOutDir: true,
        target: 'node20',
        rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'server.mjs', banner: '#!/usr/bin/env node' } },
    },
});
