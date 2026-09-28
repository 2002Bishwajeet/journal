import * as Y from 'yjs';
import { getDocumentUpdates } from '@/lib/db';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';

/**
 * Extracts markdown from a Yjs document's TipTap content.
 *
 * @param noteId - The local document ID (for local notes)
 * @param yjsBlob - Optional Yjs blob (for remote/shared notes)
 */
export async function extractMarkdownFromYjs(noteId: string, yjsBlob?: Uint8Array): Promise<string> {
  const ydoc = new Y.Doc();

  if (yjsBlob) {
    Y.applyUpdate(ydoc, yjsBlob);
  } else {
    // Local extraction using PGlite updates
    const updates = await getDocumentUpdates(noteId);
    if (updates.length === 0) return '';

    for (const update of updates) {
      Y.applyUpdate(ydoc, update);
    }
  }

  // TipTap stores content in a Y.XmlFragment named 'prosemirror'
  const xmlFragment = ydoc.getXmlFragment('prosemirror');

  return fragmentToMarkdown(xmlFragment);
}

/**
 * Extracts clean plain text from a Yjs document for sidebar previews.
 * Removes markdown syntax and extra whitespace.
 */
export async function extractPreviewTextFromYjs(noteId: string, yjsBlob?: Uint8Array): Promise<string> {
  const ydoc = new Y.Doc();

  if (yjsBlob) {
    try {
      Y.applyUpdate(ydoc, yjsBlob);
    } catch (e) {
      console.error('Failed to apply update to ydoc', e);
      return '';
    }
  } else {
    // Local extraction using PGlite updates
    const updates = await getDocumentUpdates(noteId);
    if (updates.length === 0) return '';

    for (const update of updates) {
      Y.applyUpdate(ydoc, update);
    }
  }

  // TipTap stores content in a Y.XmlFragment named 'prosemirror'
  const xmlFragment = ydoc.getXmlFragment('prosemirror');

  // Simple extraction: iterate over elements and get text content only
  let text = '';

  const extractText = (node: Y.XmlElement | Y.XmlText): string => {
    if (node instanceof Y.XmlText) {
      // Use toDelta() to reliably get plain text without XML tags/attributes
      const delta = node.toDelta();
      return (delta as Array<{ insert?: unknown }>).map((op) => {
        if (typeof op.insert === 'string') {
          return op.insert;
        }
        return ''; // Ignore embeds
      }).join('');
    }

    const nodeName = node.nodeName;
    let content = '';

    node.toArray().forEach((child) => {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
        content += extractText(child);
      }
    });

    // Add spacing for block elements to prevent words running together
    switch (nodeName) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
      case 'blockquote':
      case 'listItem':
      case 'taskItem':
        return content + ' ';
      case 'hardBreak':
        return ' ';
      default:
        return content;
    }
  };

  xmlFragment.toArray().forEach((child) => {
    if (child instanceof Y.XmlElement) {
      text += extractText(child);
    }
  });

  // Collapse multiple spaces/newlines into single spaces and trim
  return text.replace(/\s+/g, ' ').trim();
}
