/**
 * Regression for #247. Production builds run the React Compiler, which turns
 * `editor?.commands.focus()` inside effects/handlers into a render-time memo
 * dependency check on `editor?.commands`. TipTap's `commands` getter throws on a
 * destroyed editor ("Cannot read properties of null (reading 'commands')"), and
 * useEditor can destroy its first instance while a time-sliced render of the
 * note page is still running. React recovered by re-rendering synchronously and
 * reported "Minified React error #520" to window `error`. The compiled bar must
 * not read `commands` during render.
 */
import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';
import reactCompiler from 'babel-plugin-react-compiler';
import source from '@/components/editor/FindReplaceBar.tsx?raw';

function compile(): string {
    const result = transformSync(source, {
        filename: 'FindReplaceBar.tsx',
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [[reactCompiler, {}]],
    });
    return result?.code ?? '';
}

describe('FindReplaceBar under the React Compiler', () => {
    it('does not read editor.commands during render', () => {
        const code = compile();
        const memoChecks = code.split('\n').filter((line) => /\$\[\d+\] !==/.test(line));

        expect(memoChecks.length).toBeGreaterThan(0);
        expect(memoChecks.filter((line) => line.includes('.commands'))).toEqual([]);
    });
});
