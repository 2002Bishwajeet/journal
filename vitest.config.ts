import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';
import { pieceStubs } from './packages/live-blocks/test/pieceStubs';

export default defineConfig({
    define: {
        __APP_BUILD__: '"test"',
    },

    test: {
        // Use Node environment for database tests (PGlite runs in Node)
        environment: 'node',

        // Include test files
        // The live-blocks package's unit tests too; its test/published/ needs the package built first.
        include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.ts', 'packages/live-blocks/test/*.test.{ts,tsx}'],

        // Global test timeout (some DB operations may take time)
        testTimeout: 30000,

        // Run tests serially to avoid database conflicts
        sequence: {
            shuffle: false,
        },

        fileParallelism: true,
        maxWorkers: 4,
    },

    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, './src'),
            // Paid code from the optional private submodule native/, or its stub without it.
            '@premium': path.resolve(import.meta.dirname, fs.existsSync(path.resolve(import.meta.dirname, 'native/web/index.ts')) ? 'native/web/index.ts' : 'src/lib/premiumStub.ts'),
            // Supplied by vite-plugin-pwa at build time, so it does not resolve
            // under vitest — and that failure happens in import analysis, before
            // vi.mock can intercept it.
            'virtual:pwa-register/react': path.resolve(import.meta.dirname, './src/__tests__/stubs/pwaRegister.ts'),
            // The workspace package's source, as vite.config.ts resolves it.
            '@2002bishwajeet/live-blocks': path.resolve(import.meta.dirname, './packages/live-blocks/src'),
            // Built by the live-blocks package's plugin (build/pieces.ts), which vitest does not load.
            ...pieceStubs,
        },
    },
});
