import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockNodeView } from './nodes/CodeBlockNodeView';
import { CodeBlockHighlight, createBaseExtensions } from './plugins/extensions';
import { ImageSchema } from './nodes/imageSchema';
import { ImageNodeView } from './nodes/ImageNode';
import { NoteLink } from './nodes/NoteLinkNode';
import { NoteLinkNodeView } from './nodes/NoteLinkNodeView';
import { LinkPreview } from './nodes/LinkPreviewNode';
import { LinkPreviewNodeView } from './nodes/LinkPreviewNodeView';
import { Toggle } from './nodes/ToggleNode';
import { ToggleNodeView } from './nodes/ToggleNodeView';
import { Callout } from './nodes/CalloutNode';
import { CalloutNodeView } from './nodes/CalloutNodeView';
import { EmojiExtension } from './plugins/EmojiExtension';
import { AgentEditPreview } from './plugins/AgentEditPreview';

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

/** LinkPreview's schema plus the React node view (LinkPreviewNodeView.tsx). */
const LinkPreviewWithView = LinkPreview.extend({
  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewNodeView);
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

/** The headless code block plus the React node view (CodeBlockNodeView.tsx). */
const CodeBlockWithView = CodeBlockHighlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});

/**
 * The editor's full extension list (#316): createBaseExtensions()'s headless
 * schema with the React node views (image, noteLink, linkPreview, toggle, callout,
 * codeBlock), the emoji suggestion popup and the agent edit preview (#701). Only the editor
 * imports this — headless code (the agent edit engine) stays on createBaseExtensions() so it never pulls in React.
 */
export function createEditorExtensions() {
  const extensions = createBaseExtensions({
    image: CustomImage,
    noteLink: NoteLinkWithView,
    linkPreview: LinkPreviewWithView,
    toggle: ToggleWithView,
    callout: CalloutWithView,
    uiExtensions: [EmojiExtension, AgentEditPreview],
  });
  // The headless code block is configured in plugins/extensions.ts (shared with
  // the edit engine); extend it in place so its lowlight options carry over.
  return extensions.map((ext) => (ext.name === CodeBlockHighlight.name ? CodeBlockWithView.configure(ext.options) : ext));
}
