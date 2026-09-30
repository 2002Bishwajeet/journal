/**
 * Compiles a `react` live block's JSX to plain script for its frame (#426). JSX becomes
 * React.createElement calls, and import/export become CommonJS so `export default` works
 * (reactBlockDocument in liveBlocks.ts supplies `exports` and `require`). Only ever
 * imported dynamically, so the compiler loads when a React block is on screen.
 */
import { transform } from 'sucrase';

export function compileReactBlock(source: string): { code: string } | { error: string } {
  try {
    return { code: transform(source, { transforms: ['jsx', 'imports'], production: true }).code };
  } catch (err) {
    // Sucrase ends a syntax error's message with "(line:column)".
    const { message, loc } = err as { message: string; loc?: { line: number } };
    return { error: loc ? `Line ${loc.line}: ${message.replace(/ \(\d+:\d+\)$/, '')}` : message };
  }
}
