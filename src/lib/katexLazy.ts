/**
 * What `katex` resolves to inside @tiptap/extension-mathematics (vite.config.ts, #673),
 * so KaTeX and its stylesheet load only once a note shows math. A math node shows its
 * raw LaTeX until then.
 */
import type { KatexOptions } from 'katex';

type Katex = typeof import('katex').default;

let katex: Promise<Katex> | undefined;
const loadKatex = (): Promise<Katex> =>
    (katex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
        ([module]) => module.default,
        (error) => {
            katex = undefined; // the next math node tries again
            throw error;
        },
    ));

function render(latex: string, element: HTMLElement, options?: KatexOptions): void {
    element.textContent = latex;
    loadKatex().then(
        (loaded) => {
            try {
                loaded.render(latex, element, options);
            } catch {
                // KaTeX empties the element before it parses; invalid LaTeX shows its raw
                // text again, as the extension's own catch does.
                element.textContent = latex;
            }
        },
        () => {},
    );
}

export default { render };
