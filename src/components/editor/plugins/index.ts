/**
 * Editor Plugins Index
 * 
 * Central export point for all editor plugins and extensions.
 * Import from here to get everything needed for the editor.
 */

// Extension configurations
export { createBaseExtensions } from './extensions';
export type { ExtensionOptions } from './extensions';

// Y.js collaboration
export { createCollaborationExtension, undo, redo } from './collaboration';

// Custom shortcuts
export { CustomShortcuts } from './shortcuts';
export type { CustomShortcutsOptions } from './shortcuts';

// AI-powered plugins (conditionally used when AI is enabled)
export { AutocompletePlugin } from './AutocompletePlugin';
export { GrammarPlugin } from './GrammarPlugin';
