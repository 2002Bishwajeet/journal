import { ReactNodeViewRenderer } from '@tiptap/react';
import { createBaseExtensions } from './plugins/extensions';
import { ImageSchema } from './nodes/imageSchema';
import { ImageNodeView } from './nodes/ImageNode';
import { NoteLink } from './nodes/NoteLinkNode';
import { NoteLinkNodeView } from './nodes/NoteLinkNodeView';
import { Toggle } from './nodes/ToggleNode';
import { ToggleNodeView } from './nodes/ToggleNodeView';
import { Callout } from './nodes/CalloutNode';
import { CalloutNodeView } from './nodes/CalloutNodeView';
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

/** Toggle's schema plus the React node view (ToggleNodeView.tsx). */
const ToggleWithView = Toggle.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView);
  },
});

/** Callout's schema plus the React node view (CalloutNodeView.tsx). */
const CalloutWithView = Callout.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});

/**
 * The editor's full extension list (#316): createBaseExtensions()'s headless
 * schema with the React node views (image, noteLink, toggle, callout) and the
 * emoji suggestion popup. Only the editor imports this — headless code (the
 * agent edit engine) stays on createBaseExtensions() so it never pulls in React.
 */
export function createEditorExtensions() {
  return createBaseExtensions({
    image: CustomImage,
    noteLink: NoteLinkWithView,
    toggle: ToggleWithView,
    callout: CalloutWithView,
    uiExtensions: [EmojiExtension],
  });
}
