import * as Y from 'yjs';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import { previewTextFromFragment } from '@/lib/yjs/previewText';

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
 * Removes markdown syntax and extra whitespace. Prose comes first; code-block
 * (and live-block) text follows a separator so previews skip it but search keeps it.
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

  return previewTextFromFragment(xmlFragment);
}
