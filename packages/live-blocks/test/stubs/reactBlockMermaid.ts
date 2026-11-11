/**
 * `virtual:react-block-mermaid` is built by build/pieces.ts (the mermaid a `mermaid`
 * live block runs on, #946), which vitest does not load. test/pieceStubs.ts aliases the specifier
 * here so the import resolves; tests see this marker in place of the runtime.
 */
export default '/* react-block-mermaid stub */';
