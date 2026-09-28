import path from 'node:path';
import { defineConfig } from 'vite';

// Bundles the MCP server into one file for the `journal-mcp` package the Claude Code
// plugin runs via npx. Everything is inlined except the native keychain module, which
// npm installs per platform from the package's dependencies.
export default defineConfig({
    root: path.resolve(import.meta.dirname, '..'),
    publicDir: false,
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
