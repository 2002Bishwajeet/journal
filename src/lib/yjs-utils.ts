import * as Y from 'yjs';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';

/**
 * Extracts markdown from a Yjs document's TipTap content.
 *
 * @param noteId - The local document ID (for local notes)
 * @param yjsBlob - Optional Yjs blob (for remote/shared notes), or an already-decoded doc
 *   (the caller owns it; it is only read here, synchronously)
 */
export async function extractMarkdownFromYjs(noteId: string, yjsBlob?: Uint8Array | Y.Doc): Promise<string> {
  let ydoc: Y.Doc | null;

  if (yjsBlob instanceof Y.Doc) {
    ydoc = yjsBlob;
  } else if (yjsBlob) {
    ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, yjsBlob);
  } else {
    // Local extraction using PGlite updates
    ydoc = await loadLocalYDoc(noteId);
    if (!ydoc) return '';
  }

  // TipTap stores content in a Y.XmlFragment named 'prosemirror'
  return fragmentToMarkdown(ydoc.getXmlFragment('prosemirror'));
}

/**
 * Extracts clean plain text from a Yjs document for sidebar previews.
 * Removes markdown syntax and extra whitespace.
 */
export async function extractPreviewTextFromYjs(noteId: string, yjsBlob?: Uint8Array): Promise<string> {
  let ydoc: Y.Doc | null;

  if (yjsBlob) {
    ydoc = new Y.Doc();
    try {
      Y.applyUpdate(ydoc, yjsBlob);
    } catch (e) {
      console.error('Failed to apply update to ydoc', e);
      return '';
    }
  } else {
    // Local extraction using PGlite updates
    ydoc = await loadLocalYDoc(noteId);
    if (!ydoc) return '';
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
      case 'callout':
      case 'listItem':
      case 'taskItem':
        return content + ' ';
      case 'toggle':
        // The summary is an attribute, so it isn't part of the child text.
        return (node.getAttribute('summary') ?? '') + ' ' + content + ' ';
      case 'linkPreview':
        return `${node.getAttribute('title') ?? ''} ${node.getAttribute('url') ?? ''} `;
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
