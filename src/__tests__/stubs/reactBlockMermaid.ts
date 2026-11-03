/**
 * `virtual:react-block-mermaid` is built by a plugin in vite.config.ts (the mermaid a `mermaid`
 * live block runs on, #946), which vitest does not load. vitest.config.ts aliases the specifier
 * here so the import resolves; tests see this marker in place of the runtime.
 */
export default '/* react-block-mermaid stub */';
