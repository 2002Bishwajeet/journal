/**
 * Compiles a `react` live block's JSX to plain script for its frame (#426). JSX becomes
 * React.createElement calls, and import/export become CommonJS so `export default` works
 * (reactBlockDocument in liveBlocks.ts supplies `exports` and `require`). Only ever
 * imported dynamically, so the compiler loads when a React block is on screen. So does
 * Tailwind's compiler, for the classes a block has beyond the fixed sheet (#559).
 */
import { transform } from 'sucrase';
import { compile } from 'tailwindcss';
import tailwindThemeCss from 'virtual:react-block-tailwind-theme';
import { TAILWIND_UTILITIES, tailwindTheme } from '@/lib/reactBlockTailwind';

export function compileReactBlock(source: string): { code: string } | { error: string } {
  try {
    return { code: transform(source, { transforms: ['jsx', 'imports'], production: true }).code };
  } catch (err) {
    // Sucrase ends a syntax error's message with "(line:column)".
    const { message, loc } = err as { message: string; loc?: { line: number } };
    return { error: loc ? `Line ${loc.line}: ${message.replace(/ \(\d+:\d+\)$/, '')}` : message };
  }
}

/**
 * The modules a compiled block imports, in order, each once: the names in its `require('…')`
 * calls, which is what the `imports` transform makes of every import (#427).
 */
export function reactBlockImports(code: string): string[] {
  return [...new Set(Array.from(code.matchAll(/\brequire\('([^']*)'\)/g), (match) => match[1]))];
}

const FIXED = new Set(TAILWIND_UTILITIES);

/**
 * The Tailwind a block's source spells out beyond the fixed sheet (#559): arbitrary values
 * (`bg-[#ff6600]`), `md:` and `lg:`, real colours under `palette-raw`, and any other
 * utility. Compiled by Tailwind in the app, in the same theme as the fixed sheet, for the
 * page to put after it. Empty for a block whose classes are all in the fixed sheet, so such
 * a block's page is what it was. Otherwise the sheet has every class of the block, so they
 * keep Tailwind's order among themselves. `palette-raw` anywhere in the block draws all of
 * its palette classes in Tailwind's own colours. `dark:` matches nothing, as in the fixed sheet.
 */
export async function compileBlockTailwind(source: string): Promise<string> {
  // Every word the source has could be a class, as Tailwind's own scanner assumes; one
  // that is not a utility compiles to nothing.
  const candidates = [...new Set(source.split(/[\s"'`]+/))];
  const rawPalette = candidates.includes('palette-raw');
  const compiler = await compile(`${tailwindTheme({ rawPalette })}\n@custom-variant dark (&:not(*));\n@tailwind utilities;`, {
    loadStylesheet: async () => ({ path: 'tailwindcss/theme.css', base: '', content: tailwindThemeCss }),
  });
  if (!rawPalette) {
    const nothing = compiler.build([]);
    if (compiler.build(candidates.filter((candidate) => !FIXED.has(candidate))) === nothing) return '';
  }
  return compiler.build(candidates);
}
