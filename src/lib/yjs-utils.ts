import * as Y from 'yjs';
import { getDocumentUpdates } from '@/lib/db';

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

  // Backtick fence long enough to wrap text that itself contains backticks —
  // otherwise an interior ``` would prematurely close a code span/block and
  // corrupt everything after it.
  function longestBacktickRun(s: string): number {
    const runs = s.match(/`+/g);
    return runs ? Math.max(...runs.map((r) => r.length)) : 0;
  }

  // A single formatted text run -> markdown. Marks without a markdown form
  // (underline, sub/superscript) become HTML, which the share page renders via
  // rehype-raw. Surrounding whitespace stays OUTSIDE the markers — CommonMark
  // won't open/close emphasis directly next to a space (e.g. `**word **`).
  function serializeRun(raw: string, attrs?: Record<string, unknown>): string {
    if (!attrs) return raw;
    const leading = raw.match(/^\s*/)?.[0] ?? '';
    const trailing = raw.match(/\s*$/)?.[0] ?? '';
    let core = raw.slice(leading.length, raw.length - trailing.length);
    if (!core) return raw;
    if (attrs.code) {
      const ticks = '`'.repeat(longestBacktickRun(core) + 1);
      const pad = core.startsWith('`') || core.endsWith('`') ? ' ' : '';
      core = ticks + pad + core + pad + ticks;
    }
    if (attrs.bold) core = '**' + core + '**';
    if (attrs.italic) core = '*' + core + '*';
    if (attrs.strike) core = '~~' + core + '~~';
    if (attrs.underline) core = '<u>' + core + '</u>';
    if (attrs.subscript) core = '<sub>' + core + '</sub>';
    if (attrs.superscript) core = '<sup>' + core + '</sup>';
    const link = attrs.link as { href?: string } | undefined;
    if (link?.href) core = `[${core}](${link.href})`;
    return leading + core + trailing;
  }

  // toDelta() (NOT toString(), which emits literal <bold>/<code> tags) gives each
  // run's text plus its mark attributes.
  function serializeTextNode(node: Y.XmlText): string {
    const delta = node.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
    return delta.map((op) => (typeof op.insert === 'string' ? serializeRun(op.insert, op.attributes) : '')).join('');
  }

  // Raw text without mark wrapping — used for code blocks.
  function rawTextNode(node: Y.XmlText): string {
    const delta = node.toDelta() as Array<{ insert?: unknown }>;
    return delta.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
  }

  // Inline content of a block: text runs + inline atoms (hardBreak, image,
  // inlineMath). Nested block elements are flattened to their inline text.
  function serializeInline(node: Y.XmlElement): string {
    let out = '';
    node.toArray().forEach((child) => {
      if (child instanceof Y.XmlText) {
        out += serializeTextNode(child);
      } else if (child instanceof Y.XmlElement) {
        switch (child.nodeName) {
          case 'hardBreak':
            out += '  \n'; // markdown hard break
            break;
          case 'image': {
            const src = child.getAttribute('src') || '';
            const alt = child.getAttribute('alt') || '';
            const title = child.getAttribute('title');
            if (src) out += `![${alt}](${src}${title ? ` "${title}"` : ''})`;
            break;
          }
          case 'inlineMath': {
            const latex = child.getAttribute('latex') || '';
            if (latex) out += `$${latex}$`;
            break;
          }
          default:
            out += serializeInline(child);
        }
      }
    });
    return out;
  }

  function serializeList(node: Y.XmlElement, ordered: boolean, depth: number): string {
    let out = '';
    let index = 0;
    node.toArray().forEach((item) => {
      if (!(item instanceof Y.XmlElement) || item.nodeName !== 'listItem') return;
      const marker = ordered ? `${++index}. ` : '- ';
      out += renderItem(marker, marker.length, item);
    });
    return out + (depth === 0 ? '\n' : '');
  }

  function serializeTaskList(node: Y.XmlElement, depth: number): string {
    let out = '';
    node.toArray().forEach((item) => {
      if (!(item instanceof Y.XmlElement) || item.nodeName !== 'taskItem') return;
      // y-prosemirror may store the attribute as a boolean or the STRING
      // 'false' (which is truthy) — check explicitly so unchecked items stay [ ].
      const checked = item.getAttribute('checked') as unknown;
      const isChecked = checked === true || checked === 'true';
      // The "- " marker is 2 columns; the "[x] " checkbox is item content, so
      // nested lists align to column 2 (not the full "- [x] " prefix width).
      out += renderItem(`- [${isChecked ? 'x' : ' '}] `, 2, item);
    });
    return out + (depth === 0 ? '\n' : '');
  }

  // One list/task item: "<marker><inline text>" then any nested lists, with
  // continuation lines indented to the item's CONTENT column so CommonMark keeps
  // them nested. That column is the marker width — an ordered "12. " needs 4
  // spaces, a bullet "- " needs 2 — so a flat indent splits ordered lists apart.
  function renderItem(marker: string, indentWidth: number, item: Y.XmlElement): string {
    let text = '';
    let nested = '';
    item.toArray().forEach((child) => {
      if (!(child instanceof Y.XmlElement)) return;
      if (child.nodeName === 'bulletList' || child.nodeName === 'orderedList' || child.nodeName === 'taskList') {
        nested += serializeBlock(child, 1); // depth 1: no trailing blank line
      } else {
        const t = serializeInline(child).trim();
        if (t) text += (text ? ' ' : '') + t;
      }
    });
    let out = marker + text + '\n';
    if (nested.trim()) {
      const pad = ' '.repeat(indentWidth);
      out += nested.replace(/\n+$/, '').split('\n').map((l) => (l ? pad + l : l)).join('\n') + '\n';
    }
    return out;
  }

  function serializeTable(node: Y.XmlElement): string {
    const rows = node.toArray().filter((r): r is Y.XmlElement => r instanceof Y.XmlElement && r.nodeName === 'tableRow');
    if (rows.length === 0) return '';
    const cellsOf = (row: Y.XmlElement) =>
      row.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement && (c.nodeName === 'tableCell' || c.nodeName === 'tableHeader'));
    const renderRow = (row: Y.XmlElement) =>
      '| ' + cellsOf(row).map((c) => serializeInline(c).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()).join(' | ') + ' |';
    const cols = cellsOf(rows[0]).length || 1;
    const separator = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
    return [renderRow(rows[0]), separator, ...rows.slice(1).map(renderRow)].join('\n') + '\n\n';
  }

  function serializeChildren(node: Y.XmlElement, depth: number): string {
    let out = '';
    node.toArray().forEach((child) => {
      if (child instanceof Y.XmlElement) out += serializeBlock(child, depth);
      else if (child instanceof Y.XmlText) out += serializeTextNode(child);
    });
    return out;
  }

  function serializeBlock(node: Y.XmlElement, depth: number): string {
    switch (node.nodeName) {
      case 'heading': {
        const level = Number(node.getAttribute('level') || 1);
        return '#'.repeat(level) + ' ' + serializeInline(node) + '\n\n';
      }
      case 'paragraph':
        return serializeInline(node) + '\n\n';
      case 'bulletList':
        return serializeList(node, false, depth);
      case 'orderedList':
        return serializeList(node, true, depth);
      case 'taskList':
        return serializeTaskList(node, depth);
      case 'codeBlock': {
        const lang = node.getAttribute('language') || '';
        let code = '';
        node.toArray().forEach((c) => {
          if (c instanceof Y.XmlText) code += rawTextNode(c);
        });
        const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
        return fence + lang + '\n' + code + '\n' + fence + '\n\n';
      }
      case 'blockquote':
        return (
          serializeChildren(node, depth)
            .trim()
            .split('\n')
            .map((l) => (l ? '> ' + l : '>'))
            .join('\n') + '\n\n'
        );
      case 'horizontalRule':
        return '---\n\n';
      case 'blockMath': {
        const latex = node.getAttribute('latex') || '';
        return latex ? `$$\n${latex}\n$$\n\n` : '';
      }
      case 'table':
        return serializeTable(node);
      default:
        return serializeChildren(node, depth);
    }
  }

  let markdown = '';
  xmlFragment.toArray().forEach((child) => {
    if (child instanceof Y.XmlElement) markdown += serializeBlock(child, 0);
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
