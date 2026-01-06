import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        // Use Node environment for database tests (PGlite runs in Node)
        environment: 'node',

        // Include test files
        include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],

        // Global test timeout (some DB operations may take time)
        testTimeout: 30000,

        // Run tests serially to avoid database conflicts
        sequence: {
            shuffle: false,
        },

        // Single threaded to avoid database conflicts
        fileParallelism: false,
    },

    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
