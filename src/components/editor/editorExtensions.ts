import { ReactNodeViewRenderer } from '@tiptap/react';
import { createBaseExtensions } from './plugins/extensions';
import { ImageSchema } from './nodes/imageSchema';
import { ImageNodeView } from './nodes/ImageNode';
import { NoteLink } from './nodes/NoteLinkNode';
import { NoteLinkNodeView } from './nodes/NoteLinkNodeView';
import { EmojiExtension } from './plugins/EmojiExtension';

/** ImageSchema's attrs plus the React node view (ImageNode.tsx). */
const CustomImage = ImageSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

/** NoteLink's schema plus the React node view (NoteLinkNodeView.tsx). */
const NoteLinkWithView = NoteLink.extend({
  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkNodeView);
  },
});

/**
 * The editor's full extension list (#316): createBaseExtensions()'s headless
 * schema with the React node views (image, noteLink) and the emoji suggestion
 * popup. Only the editor imports this — headless code (the agent edit engine)
 * stays on createBaseExtensions() so it never pulls in React.
 */
export function createEditorExtensions() {
  return createBaseExtensions({ image: CustomImage, noteLink: NoteLinkWithView, uiExtensions: [EmojiExtension] });
}
