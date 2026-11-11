/**
 * `virtual:react-block-runtime` is built by build/pieces.ts (the React a `react`
 * live block runs on, #426), which vitest does not load. test/pieceStubs.ts aliases the
 * specifier here so the import resolves; tests see this marker in place of the runtime.
 */
export default '/* react-block-runtime stub */';
