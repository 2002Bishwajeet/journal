import { createBaseExtensions } from './plugins/extensions';
import { NoteLink } from './nodes/NoteLinkNode';

/**
 * Every extension that contributes a node or mark to the editor schema.
 * Shared by the editor and headless code (agent edit engine) so they can't drift.
 */
export function createSchemaExtensions() {
  return [...createBaseExtensions(), NoteLink];
}
