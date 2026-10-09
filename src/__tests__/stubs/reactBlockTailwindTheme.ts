/**
 * `virtual:react-block-tailwind-theme` is built by a plugin in vite.config.ts (Tailwind's
 * theme.css, #559), which vitest does not load. Tests get the same file, read from disk.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export default readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8');
