import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    define: {
        __APP_BUILD__: '"test"',
    },

    test: {
        // Use Node environment for database tests (PGlite runs in Node)
        environment: 'node',

        // Include test files
        include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.ts'],

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
            // Supplied by vite-plugin-pwa at build time, so it does not resolve
            // under vitest — and that failure happens in import analysis, before
            // vi.mock can intercept it.
            'virtual:pwa-register/react': path.resolve(import.meta.dirname, './src/__tests__/stubs/pwaRegister.ts'),
            // Built by a plugin in vite.config.ts, which vitest does not load.
            'virtual:react-block-runtime': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockRuntime.ts'),
            'virtual:react-block-tailwind': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockTailwind.ts'),
            'virtual:react-block-lucide': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockLucide.ts'),
            'virtual:react-block-recharts': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockRecharts.ts'),
            'virtual:react-block-d3': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockD3.ts'),
            'virtual:react-block-three': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockThree.ts'),
            'virtual:react-block-lodash': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockLodash.ts'),
            'virtual:react-block-mathjs': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockMathjs.ts'),
            'virtual:react-block-papaparse': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockPapaparse.ts'),
            'virtual:react-block-ui': path.resolve(import.meta.dirname, './src/__tests__/stubs/reactBlockUi.ts'),
        },
    },
});
