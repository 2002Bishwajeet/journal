/**
 * extractMarkdownFromYjs serializes a TipTap/Yjs doc to markdown for the public
 * share page (and markdown export). Regression cover for the bug where formatted
 * runs serialized as literal <bold>/<code> XML tags and hardBreaks were dropped
 * (words running together).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';

function buildBlob(build: (frag: Y.XmlFragment) => void): Uint8Array {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment('prosemirror');
  build(frag);
  return Y.encodeStateAsUpdate(doc);
}

describe('extractMarkdownFromYjs', () => {
  it('serializes bold/code marks as markdown, not literal XML tags', async () => {
    const blob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      // Insert plain, then format ranges (mirrors how TipTap stores marks and
      // avoids Yjs merging adjacent inserts at run boundaries).
      t.insert(0, 'reuse lists are here and ADDING.md');
      t.format(6, 14, { bold: true }); // "lists are here"
      t.format(25, 9, { code: true }); // "ADDING.md"
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('reuse **lists are here** and `ADDING.md`');
    expect(md).not.toContain('<bold>');
    expect(md).not.toContain('<code>');
  });

  it('keeps trailing whitespace outside emphasis markers', async () => {
    const blob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, 'word next');
      t.format(0, 5, { bold: true }); // "word " — trailing space inside the bold run
    });

    const md = await extractMarkdownFromYjs('x', blob);

    // Marker hugs the word; the space sits outside so CommonMark renders bold.
    expect(md).toBe('**word** next');
  });

  it('renders hardBreak as a line break so words do not run together', async () => {
    const blob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const a = new Y.XmlText();
      a.insert(0, 'set');
      const br = new Y.XmlElement('hardBreak');
      const b = new Y.XmlText();
      b.insert(0, 'of one');
      p.insert(0, [a, br, b]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('set  \nof one');
    expect(md).not.toContain('setof one');
  });

  it('serializes underline/subscript/superscript as inline HTML', async () => {
    const blob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, 'under sub sup');
      t.format(0, 5, { underline: true }); // "under"
      t.format(6, 3, { subscript: true }); // "sub"
      t.format(10, 3, { superscript: true }); // "sup"
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('<u>under</u> <sub>sub</sub> <sup>sup</sup>');
  });

  it('serializes an inline image as markdown image syntax', async () => {
    const blob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'https://example.com/y.png');
      img.setAttribute('alt', 'pic');
      p.insert(0, [img]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('![pic](https://example.com/y.png)');
  });

  it('numbers ordered lists and indents nested lists', async () => {
    const blob = buildBlob((frag) => {
      const ol = new Y.XmlElement('orderedList');
      frag.insert(0, [ol]);

      const li1 = new Y.XmlElement('listItem');
      const p1 = new Y.XmlElement('paragraph');
      const t1 = new Y.XmlText();
      t1.insert(0, 'first');
      p1.insert(0, [t1]);
      li1.insert(0, [p1]);

      const ul = new Y.XmlElement('bulletList');
      const liNested = new Y.XmlElement('listItem');
      const pNested = new Y.XmlElement('paragraph');
      const tNested = new Y.XmlText();
      tNested.insert(0, 'nested');
      pNested.insert(0, [tNested]);
      liNested.insert(0, [pNested]);
      ul.insert(0, [liNested]);
      li1.insert(1, [ul]);

      const li2 = new Y.XmlElement('listItem');
      const p2 = new Y.XmlElement('paragraph');
      const t2 = new Y.XmlText();
      t2.insert(0, 'second');
      p2.insert(0, [t2]);
      li2.insert(0, [p2]);

      ol.insert(0, [li1, li2]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    // Nested list indents to the ordered marker's content column (3 spaces for
    // "1. "). A flat 2-space indent renders as three sibling lists with the
    // ordered list restarting at "2." instead of one nested <ul>.
    expect(md).toBe('1. first\n   - nested\n2. second');
  });

  it('serializes task lists with checked/unchecked boxes', async () => {
    const blob = buildBlob((frag) => {
      const tl = new Y.XmlElement('taskList');
      frag.insert(0, [tl]);

      const done = new Y.XmlElement('taskItem');
      done.setAttribute('checked', 'true');
      const pDone = new Y.XmlElement('paragraph');
      const tDone = new Y.XmlText();
      tDone.insert(0, 'done');
      pDone.insert(0, [tDone]);
      done.insert(0, [pDone]);

      const todo = new Y.XmlElement('taskItem');
      todo.setAttribute('checked', 'false'); // truthy string — must still render [ ]
      const pTodo = new Y.XmlElement('paragraph');
      const tTodo = new Y.XmlText();
      tTodo.insert(0, 'todo');
      pTodo.insert(0, [tTodo]);
      todo.insert(0, [pTodo]);

      tl.insert(0, [done, todo]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('- [x] done\n- [ ] todo');
  });

  it('serializes a table as GFM pipe syntax', async () => {
    const cell = (tag: string, text: string) => {
      const c = new Y.XmlElement(tag);
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, text);
      p.insert(0, [t]);
      c.insert(0, [p]);
      return c;
    };
    const blob = buildBlob((frag) => {
      const table = new Y.XmlElement('table');
      frag.insert(0, [table]);
      const head = new Y.XmlElement('tableRow');
      head.insert(0, [cell('tableHeader', 'A'), cell('tableHeader', 'B')]);
      const body = new Y.XmlElement('tableRow');
      body.insert(0, [cell('tableCell', '1'), cell('tableCell', '2')]);
      table.insert(0, [head, body]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('serializes a fenced code block with its language', async () => {
    const blob = buildBlob((frag) => {
      const cb = new Y.XmlElement('codeBlock');
      cb.setAttribute('language', 'js');
      const t = new Y.XmlText();
      t.insert(0, 'const x = 1;');
      cb.insert(0, [t]);
      frag.insert(0, [cb]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('```js\nconst x = 1;\n```');
  });

  it('widens the code fence when the code itself contains a ``` fence', async () => {
    const blob = buildBlob((frag) => {
      const cb = new Y.XmlElement('codeBlock');
      const t = new Y.XmlText();
      t.insert(0, 'a\n```\nb');
      cb.insert(0, [t]);
      frag.insert(0, [cb]);
    });

    const md = await extractMarkdownFromYjs('x', blob);

    // Outer fence must be longer than the interior ``` so it does not close early.
    expect(md).toBe('````\na\n```\nb\n````');
  });

  it('widens inline code backticks so an interior backtick is preserved', async () => {
    const blob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, 'use a`b here');
      t.format(4, 3, { code: true }); // "a`b"
    });

    const md = await extractMarkdownFromYjs('x', blob);

    expect(md).toBe('use ``a`b`` here');
  });

  it('serializes inline and block math as LaTeX delimiters', async () => {
    const inlineBlob = buildBlob((frag) => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const t = new Y.XmlText();
      t.insert(0, 'mass ');
      p.insert(0, [t]);
      const im = new Y.XmlElement('inlineMath');
      im.setAttribute('latex', 'E=mc^2');
      p.insert(1, [im]);
    });
    expect(await extractMarkdownFromYjs('x', inlineBlob)).toBe('mass $E=mc^2$');

    const blockBlob = buildBlob((frag) => {
      const bm = new Y.XmlElement('blockMath');
      bm.setAttribute('latex', 'E=mc^2');
      frag.insert(0, [bm]);
    });
    expect(await extractMarkdownFromYjs('x', blockBlob)).toBe('$$\nE=mc^2\n$$');
  });
});
