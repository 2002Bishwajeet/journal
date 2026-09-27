/**
 * Regression for #247. Production builds run the React Compiler, which turns
 * `editor?.commands.focus()` inside effects/handlers into a render-time memo
 * dependency check on `editor?.commands`. TipTap's `commands` getter throws on a
 * destroyed editor ("Cannot read properties of null (reading 'commands')"), and
 * useEditor can destroy its first instance while a time-sliced render of the
 * note page is still running. React recovered by re-rendering synchronously and
 * reported "Minified React error #520" to window `error`. No compiled component
 * may read `commands` during render.
 */
import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';
import reactCompiler from 'babel-plugin-react-compiler';

const sources = import.meta.glob<string>('/src/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
});

function memoChecks(filename: string, source: string): string[] {
    const result = transformSync(source, {
        filename,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [[reactCompiler, {}]],
    });
    return (result?.code ?? '').split('\n').filter((line) => /\$\[\d+\] !==/.test(line));
}

describe('components under the React Compiler', () => {
    const compiled = Object.entries(sources).map(([file, source]) => [file, memoChecks(file, source)] as const);

    it('compiles FindReplaceBar and AISuggestionOverlay with memo checks', () => {
        const checked = new Map(compiled);
        expect(checked.get('/src/components/editor/FindReplaceBar.tsx')?.length).toBeGreaterThan(0);
        expect(checked.get('/src/components/editor/AISuggestionOverlay.tsx')?.length).toBeGreaterThan(0);
    });

    it('does not read editor.commands during render', () => {
        const offenders = compiled.flatMap(([file, checks]) =>
            checks.filter((line) => line.includes('.commands')).map((line) => `${file}: ${line.trim()}`));
        expect(offenders).toEqual([]);
    });
});
