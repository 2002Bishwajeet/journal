/**
 * #1427: Unlock did nothing in a production build. The React Compiler memoized the hook's
 * plain read of which notes are open on its props (note, folders), so the store's change
 * re-rendered the page with the cached `locked: true`. The open state has to be the store's
 * snapshot: every read of it sits in a getSnapshot closure, which runs on each render.
 */
import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';
import reactCompiler from 'babel-plugin-react-compiler';
import source from '@/hooks/useNoteLock.ts?raw';

const compiled = transformSync(source, {
    filename: 'useNoteLock.ts',
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[reactCompiler, {}]],
})?.code ?? '';

describe('useNoteLock under the React Compiler', () => {
    it('memoizes the hooks (the compiler ran)', () => {
        expect(compiled).toMatch(/\$\[\d+\] !==/);
    });

    it('reads whether a note or folder is open only in a getSnapshot closure', () => {
        const reads = compiled.split('\n').filter((line) => /\bis(Note|Folder)Open\(/.test(line));
        expect(reads).toHaveLength(2);
        for (const line of reads) expect(line).toMatch(/=\s*\(\)\s*=>/);
    });
});
