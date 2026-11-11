/**
 * The live-block runtime without React: reading a code block's info string, the frame's
 * page (CSP, srcdoc, bridge) and the messages that cross it, and a block's saved state.
 * For a host that only needs to know which code blocks are live (a server, a markdown
 * pipeline); `@journal/live-blocks` has all of this and the components.
 */
export * from './liveBlocks';
export * from './blockState';
export { REACT_BLOCK_IMPORTS, REACT_BLOCK_LIBRARIES, type ReactBlockLibrary } from './reactBlockLibraries';
export { THEME_DEFAULTS } from './theme';
