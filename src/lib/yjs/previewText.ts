import * as Y from 'yjs';
import { joinPreviewText } from '@/lib/previewText';

/**
 * The text a note's search index holds, read from its TipTap Y.XmlFragment. Pure (no
 * database import) so the editor and the sync paths build identical text. Prose comes
 * first; code-block text follows a separator (see previewText.ts).
 */
export function previewTextFromFragment(fragment: Y.XmlFragment): string {
  let text = '';
  let code = '';

  const attr = (node: Y.XmlElement, name: string): string => {
    const value = node.getAttribute(name);
    return typeof value === 'string' ? value : '';
  };

  const extractText = (node: Y.XmlElement | Y.XmlText): string => {
    if (node instanceof Y.XmlText) {
      // toDelta() gives plain text without XML tags/attributes
      return (node.toDelta() as Array<{ insert?: unknown }>)
        .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
        .join('');
    }

    const nodeName = node.nodeName;

    if (nodeName === 'codeBlock') {
      node.toArray().forEach((child) => {
        if (child instanceof Y.XmlElement || child instanceof Y.XmlText) code += extractText(child) + ' ';
      });
      return '';
    }

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
      case 'blockquote':
      case 'callout':
      case 'listItem':
      case 'taskItem':
        return content + ' ';
      case 'toggle':
        // The summary is an attribute, so it isn't part of the child text.
        return attr(node, 'summary') + ' ' + content + ' ';
      case 'linkPreview':
        return `${attr(node, 'title')} ${attr(node, 'url')} `;
      case 'noteLink':
        return `${attr(node, 'label')} `;
      case 'image':
        return `${attr(node, 'alt')} `;
      case 'inlineMath':
      case 'blockMath':
        return `${attr(node, 'latex')} `;
      case 'hardBreak':
        return ' ';
      default:
        return content;
    }
  };

  fragment.toArray().forEach((child) => {
    if (child instanceof Y.XmlElement) {
      text += extractText(child);
    }
  });

  return joinPreviewText(text, code);
}
