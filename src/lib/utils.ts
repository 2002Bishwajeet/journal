import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import * as Y from 'yjs';
import { getDocumentUpdates } from '@/lib/db';
import type { EncryptedKeyHeader } from "@homebase-id/js-lib/core";
import { jsonStringify64 } from "@homebase-id/js-lib/helpers";


// Re-export Homebase SDK utilities for convenience
export { getNewId, tryJsonParse, base64ToUint8Array, uint8ArrayToBase64, stringToUint8Array, byteArrayToString } from '@homebase-id/js-lib/helpers';

// shadcn/ui className utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extracts plain text from a Yjs document's TipTap content.
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

  // Simple extraction: iterate over elements and build markdown
  let markdown = '';

  const extractText = (node: Y.XmlElement | Y.XmlText): string => {
    if (node instanceof Y.XmlText) {
      return node.toString();
    }

    const nodeName = node.nodeName;
    let content = '';

    node.toArray().forEach((child) => {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
        content += extractText(child);
      }
    });

    // Map TipTap node types to markdown
    switch (nodeName) {
      case 'heading': {
        const level = node.getAttribute('level') || 1;
        return '#'.repeat(Number(level)) + ' ' + content + '\n\n';
      }
      case 'paragraph':
        return content + '\n\n';
      case 'bulletList':
      case 'orderedList':
        return content + '\n';
      case 'listItem':
        return '- ' + content + '\n';
      case 'taskList':
        return content + '\n';
      case 'taskItem': {
        const checked = node.getAttribute('checked');
        return `- [${checked ? 'x' : ' '}] ` + content + '\n';
      }
      case 'codeBlock':
        return '```\n' + content + '\n```\n\n';
      case 'blockquote':
        return '> ' + content.split('\n').join('\n> ') + '\n\n';
      case 'horizontalRule':
        return '---\n\n';
      default:
        return content;
    }
  };

  xmlFragment.toArray().forEach((child) => {
    if (child instanceof Y.XmlElement) {
      markdown += extractText(child);
    }
  });

  return markdown.trim();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return delta.map((op: any) => {
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



/**
 * Serialize EncryptedKeyHeader to JSON string for database storage.
 * Converts Uint8Array fields to base64 strings.
 */
export function serializeKeyHeader(keyHeader: EncryptedKeyHeader): string {
  return jsonStringify64(keyHeader);
}


export function validateKeyHeader(result: EncryptedKeyHeader): boolean {
  return (
    typeof result.encryptionVersion === 'number' &&
    typeof result.type === 'string' &&
    result.iv.length > 0 &&
    result.encryptedAesKey.length > 0
  );
}