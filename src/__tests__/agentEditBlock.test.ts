/**
 * Block-level agent edits (#560): get_note's block ids and edit_block's ops. Each op must
 * change only the block (row, column, cell) it addresses: every other block keeps its Yjs
 * items, so a concurrent human edit elsewhere merges with nothing lost.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, createDoc, editBlock, noteBlocks, replaceInNote, toMarkdown } from '@/lib/agent/editEngine';

const frag = (doc: Y.Doc) => doc.getXmlFragment('prosemirror');
const topElements = (doc: Y.Doc) => frag(doc).toArray() as Y.XmlElement[];
const ids = (doc: Y.Doc) => noteBlocks(doc).map((block) => block.id);
const reload = (doc: Y.Doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};
const sync = (a: Y.Doc, b: Y.Doc) => {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
};

/** Every Yjs item under `type` (attributes included), as `client:clock:deleted`. */
function itemIds(type: { _map: Map<string, Y.Item>; _start: Y.Item | null }): string[] {
  const out: string[] = [];
  const add = (item: Y.Item) => {
    out.push(`${item.id.client}:${item.id.clock}:${item.deleted}`);
    if (item.content instanceof Y.ContentType) out.push(...itemIds(item.content.type));
  };
  type._map.forEach(add);
  for (let item = type._start; item; item = item.right) add(item);
  return out;
}

/** A doc built from ProseMirror JSON, as the editor writes it (e.g. a table with column widths). */
function docFromJSON(content: unknown[]): Y.Doc {
  const doc = new Y.Doc();
  const pm = editorSchema.nodeFromJSON({ type: 'doc', content });
  doc.transact(() => updateYFragment(doc, frag(doc), pm, { mapping: new Map(), isOMark: new Map() }));
  return doc;
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (type: 'tableHeader' | 'tableCell', text: string, colwidth: number[]) => ({
  type,
  attrs: { colwidth },
  content: [para(text)],
});
/** A 3×2 table with column widths 120 and 240, between two paragraphs. */
const tableDoc = () =>
  docFromJSON([
    para('Before'),
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Day', [120]), cell('tableHeader', 'Plan', [240])] },
        { type: 'tableRow', content: [cell('tableCell', 'Mon', [120]), cell('tableCell', 'Rest', [240])] },
        { type: 'tableRow', content: [cell('tableCell', 'Tue', [120]), cell('tableCell', 'Walk', [240])] },
      ],
    },
    para('After'),
  ]);

const tableNode = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(frag(doc), editorSchema).child(1);
const colwidths = (doc: Y.Doc) => {
  const widths: unknown[][] = [];
  tableNode(doc).forEach((row) => {
    const rowWidths: unknown[] = [];
    row.forEach((c) => rowWidths.push(c.attrs.colwidth));
    widths.push(rowWidths);
  });
  return widths;
};
const cellEls = (doc: Y.Doc) => (topElements(doc)[1].toArray() as Y.XmlElement[]).map((row) => row.toArray() as Y.XmlElement[]);
const tableId = (doc: Y.Doc) => noteBlocks(doc)[1].id;

describe('noteBlocks', () => {
  it('should list each top-level block with its type, markdown and editable attributes', () => {
    const doc = createDoc(
      [
        '## Plan',
        '> [!tip]\n> Pack light.',
        '<details>\n<summary>More</summary>\n\nHidden\n\n</details>',
        '```react wide id=k3f9\nexport default () => null\n```',
        '- [x] book\n- [ ] pack',
        'Plain text',
      ].join('\n\n')
    );
    const blocks = noteBlocks(doc);
    expect(blocks.map((b) => [b.type, b.attrs])).toEqual([
      ['heading', { level: 2 }],
      ['callout', { variant: 'tip' }],
      ['toggle', { summary: 'More' }],
      ['codeBlock', { language: 'react', id: 'k3f9', wide: true }],
      ['taskList', { checked: [true, false] }],
      ['paragraph', {}],
    ]);
    expect(blocks[0].markdown).toBe('## Plan');
    expect(blocks[5].markdown).toBe('Plain text');
    expect(new Set(blocks.map((b) => b.id)).size).toBe(6);
    for (const b of blocks) expect(b.id).toMatch(/^\d+:\d+$/);
  });

  it("should give a table's cells as markdown rows", () => {
    const doc = createDoc('| Day | Plan |\n| --- | --- |\n| Mon | **Rest** |');
    expect(noteBlocks(doc)[0].rows).toEqual([
      ['Day', 'Plan'],
      ['Mon', '**Rest**'],
    ]);
  });
});

describe('block ids', () => {
  it('should stay the same after a reload or sync to another device', () => {
    const doc = createDoc('One\n\nTwo\n\nThree');
    const device = reload(doc);
    expect(ids(device)).toEqual(ids(doc));
    sync(doc, device);
    expect(ids(device)).toEqual(ids(doc));
  });

  it('should address the same block after unrelated edits', () => {
    const doc = createDoc('One\n\nTwo\n\nThree');
    const [one, two, three] = ids(doc);

    editBlock(doc, one, { type: 'insert_before', markdown: 'Zero' });
    replaceInNote(doc, 'Three', 'Three!');
    // A human typing in "Two" on another device, synced back.
    const device = reload(doc);
    const text = topElements(device)[2].get(0) as Y.XmlText;
    text.insert(3, ' and a half');
    sync(doc, device);

    const blocks = noteBlocks(reload(doc));
    expect(blocks.slice(1).map((b) => b.id)).toEqual([one, two, three]);
    expect(blocks.map((b) => b.markdown)).toEqual(['Zero', 'One', 'Two and a half', 'Three!']);
    editBlock(doc, two, { type: 'replace', markdown: 'Second' });
    expect(toMarkdown(doc)).toContain('Second');
  });

  it('should fail clearly for an unknown or deleted block id', () => {
    const doc = createDoc('One\n\nTwo');
    const [one] = ids(doc);
    expect(() => editBlock(doc, '1:2', { type: 'delete' })).toThrow('block not found; call get_note with format blocks');
    editBlock(doc, one, { type: 'delete' });
    expect(() => editBlock(doc, one, { type: 'replace', markdown: 'x' })).toThrow('block not found; call get_note with format blocks');
  });
});

describe('editBlock: whole blocks', () => {
  it('replace should change only that block, leaving every other block’s items unchanged', () => {
    const doc = createDoc('# Title\n\nKeep me\n\nChange me\n\nKeep me too');
    const before = topElements(doc).map(itemIds);
    const [, , target] = ids(doc);

    expect(editBlock(doc, target, { type: 'replace', markdown: 'Changed **now**' })).toEqual([target]);

    const after = topElements(doc).map(itemIds);
    expect([after[0], after[1], after[3]]).toEqual([before[0], before[1], before[3]]);
    expect(toMarkdown(doc)).toBe('# Title\n\nKeep me\n\nChanged **now**\n\nKeep me too');
  });

  it('replace with another type or several blocks should return the new ids in order', () => {
    const doc = createDoc('A\n\nB\n\nC');
    const [a, b, c] = ids(doc);
    const result = editBlock(doc, b, { type: 'replace', markdown: '## B1\n\nB2' });
    expect(result).toHaveLength(2);
    expect(ids(doc)).toEqual([a, ...result, c]);
    expect(noteBlocks(doc).map((x) => x.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph']);
  });

  it('insert_before and insert_after should add blocks next to it', () => {
    const doc = createDoc('Middle');
    const [middle] = ids(doc);
    const [first] = editBlock(doc, middle, { type: 'insert_before', markdown: 'First' });
    const [last] = editBlock(doc, middle, { type: 'insert_after', markdown: 'Last' });
    expect(ids(doc)).toEqual([first, middle, last]);
    expect(toMarkdown(doc)).toBe('First\n\nMiddle\n\nLast');
  });

  it('delete should remove only that block, and leave an empty paragraph in an emptied note', () => {
    const doc = createDoc('Same\n\nSame\n\nOther');
    const [first, second, other] = ids(doc);
    const kept = itemIds(topElements(doc)[1]);
    expect(editBlock(doc, first, { type: 'delete' })).toEqual([]);
    expect(ids(doc)).toEqual([second, other]);
    expect(itemIds(topElements(doc)[0])).toEqual(kept);

    editBlock(doc, second, { type: 'delete' });
    editBlock(doc, other, { type: 'delete' });
    expect(noteBlocks(doc).map((b) => [b.type, b.markdown])).toEqual([['paragraph', '']]);
  });

  it('should merge with a human typing in another block at the same time', () => {
    const agent = createDoc('Agent edits this\n\nHuman types here');
    const human = reload(agent);
    const [first] = ids(agent);

    editBlock(agent, first, { type: 'replace', markdown: 'Agent edited this' });
    (topElements(human)[1].get(0) as Y.XmlText).insert(16, ' and more');
    sync(agent, human);

    expect(toMarkdown(agent)).toBe('Agent edited this\n\nHuman types here and more');
    expect(toMarkdown(human)).toBe(toMarkdown(agent));
  });

  it('should keep footnote numbers and the footnotes section in step', () => {
    const doc = createDoc('Fact[^1]\n\nMore\n\n[^1]: Source');
    const [, more] = ids(doc);
    editBlock(doc, more, { type: 'replace', markdown: 'More[^1]' });
    expect(toMarkdown(doc)).toBe('Fact[^1]\n\nMore[^1]\n\n[^1]: Source');
  });
});

describe('editBlock: set_text and set_attrs', () => {
  it("set_text should replace a callout's body and keep its variant and id", () => {
    const doc = createDoc('> [!warning]\n> Old body\n\nAfter');
    const [callout] = ids(doc);
    editBlock(doc, callout, { type: 'set_text', markdown: 'New body\n\n- a list' });
    expect(noteBlocks(doc)[0]).toMatchObject({ id: callout, type: 'callout', attrs: { variant: 'warning' } });
    expect(toMarkdown(doc)).toBe('> [!warning]\n> New body\n>\n> - a list\n\nAfter');
  });

  it("set_text should replace a toggle's body and keep its summary", () => {
    const doc = createDoc('<details>\n<summary>Spoiler</summary>\n\nOld\n\n</details>');
    const [toggle] = ids(doc);
    editBlock(doc, toggle, { type: 'set_text', markdown: 'New' });
    expect(noteBlocks(doc)[0]).toMatchObject({ id: toggle, attrs: { summary: 'Spoiler' } });
    expect(toMarkdown(doc)).toContain('New');
    expect(toMarkdown(doc)).not.toContain('Old');
  });

  it('set_text should refuse a block that is not a callout or toggle', () => {
    const doc = createDoc('Plain');
    expect(() => editBlock(doc, ids(doc)[0], { type: 'set_text', markdown: 'x' })).toThrow('set_text works on a callout or toggle');
  });

  it('set_attrs should change a callout variant, toggle summary and heading level in place', () => {
    const doc = createDoc('> [!info]\n> Body\n\n<details>\n<summary>Old</summary>\n\nBody\n\n</details>\n\n# Title');
    const [callout, toggle, heading] = ids(doc);
    const body = itemIds(topElements(doc)[0].get(0) as Y.XmlElement);
    editBlock(doc, callout, { type: 'set_attrs', attrs: { variant: 'error' } });
    editBlock(doc, toggle, { type: 'set_attrs', attrs: { summary: 'New' } });
    editBlock(doc, heading, { type: 'set_attrs', attrs: { level: 3 } });
    expect(noteBlocks(doc).map((b) => [b.id, b.attrs])).toEqual([
      [callout, { variant: 'error' }],
      [toggle, { summary: 'New' }],
      [heading, { level: 3 }],
    ]);
    expect(itemIds(topElements(doc)[0].get(0) as Y.XmlElement)).toEqual(body);
  });

  it("set_attrs should change a code block's language, live block id and wide, keeping its code", () => {
    const doc = createDoc('```html\n<p>hi</p>\n```');
    const [code] = ids(doc);
    editBlock(doc, code, { type: 'set_attrs', attrs: { id: 'k3f9', wide: true } });
    expect(toMarkdown(doc)).toBe('```html wide id=k3f9\n<p>hi</p>\n```');
    editBlock(doc, code, { type: 'set_attrs', attrs: { language: 'react', wide: false } });
    expect(noteBlocks(doc)[0].attrs).toEqual({ language: 'react', id: 'k3f9', wide: false });
    expect(() => editBlock(doc, code, { type: 'set_attrs', attrs: { id: 'Bad id' } })).toThrow('id must be 4 to 12');
  });

  it('set_attrs should check and uncheck tasks', () => {
    const doc = createDoc('- [ ] one\n- [x] two');
    editBlock(doc, ids(doc)[0], { type: 'set_attrs', attrs: { checked: [true, false] } });
    expect(toMarkdown(doc)).toBe('- [x] one\n- [ ] two');
    expect(() => editBlock(doc, ids(doc)[0], { type: 'set_attrs', attrs: { checked: [true] } })).toThrow('one value per task (2)');
  });

  it('set_attrs should refuse an attribute the block does not have', () => {
    const doc = createDoc('# Title');
    expect(() => editBlock(doc, ids(doc)[0], { type: 'set_attrs', attrs: { variant: 'tip' } })).toThrow(
      'a heading block has no settable variant; it takes level'
    );
  });
});

describe('editBlock: tables', () => {
  it('set_cell should change one cell, keeping the other cells’ items and the column widths', () => {
    const doc = tableDoc();
    const before = cellEls(doc).map((row) => row.map(itemIds));
    const outside = [topElements(doc)[0], topElements(doc)[2]].map(itemIds);

    editBlock(doc, tableId(doc), { type: 'set_cell', row: 1, col: 1, markdown: '**Hike**' });

    const after = cellEls(doc).map((row) => row.map(itemIds));
    after.forEach((row, r) =>
      row.forEach((items, c) => {
        if (r !== 1 || c !== 1) expect(items).toEqual(before[r][c]);
      })
    );
    expect([topElements(doc)[0], topElements(doc)[2]].map(itemIds)).toEqual(outside);
    expect(noteBlocks(doc)[1].rows).toEqual([
      ['Day', 'Plan'],
      ['Mon', '**Hike**'],
      ['Tue', 'Walk'],
    ]);
    expect(colwidths(doc)).toEqual([
      [[120], [240]],
      [[120], [240]],
      [[120], [240]],
    ]);
  });

  it('insert_row should add a row with the column widths, keeping every other row', () => {
    const doc = tableDoc();
    const before = cellEls(doc).map((row) => row.map(itemIds));
    editBlock(doc, tableId(doc), { type: 'insert_row', at: 2, cells: ['Sun', 'Swim'] });
    const after = cellEls(doc).map((row) => row.map(itemIds));
    expect([after[0], after[1], after[3]]).toEqual(before);
    expect(noteBlocks(doc)[1].rows).toEqual([
      ['Day', 'Plan'],
      ['Mon', 'Rest'],
      ['Sun', 'Swim'],
      ['Tue', 'Walk'],
    ]);
    expect(colwidths(doc)[2]).toEqual([[120], [240]]);
  });

  it('delete_row should remove that row only, even when rows are equal', () => {
    const doc = tableDoc();
    const id = tableId(doc);
    editBlock(doc, id, { type: 'set_cell', row: 2, col: 0, markdown: 'Mon' });
    editBlock(doc, id, { type: 'set_cell', row: 2, col: 1, markdown: 'Rest' });
    const kept = cellEls(doc)[2].map(itemIds);
    editBlock(doc, id, { type: 'delete_row', at: 1 });
    expect(cellEls(doc)[1].map(itemIds)).toEqual(kept);
    expect(noteBlocks(doc)[1].rows).toEqual([
      ['Day', 'Plan'],
      ['Mon', 'Rest'],
    ]);
  });

  it('insert_column and delete_column should change each row at that column only, keeping widths', () => {
    const doc = tableDoc();
    const id = tableId(doc);
    const before = cellEls(doc).map((row) => row.map(itemIds));

    editBlock(doc, id, { type: 'insert_column', at: 1 });
    expect(cellEls(doc).map((row) => [itemIds(row[0]), itemIds(row[2])])).toEqual(before);
    expect(noteBlocks(doc)[1].rows).toEqual([
      ['Day', '', 'Plan'],
      ['Mon', '', 'Rest'],
      ['Tue', '', 'Walk'],
    ]);
    expect(tableNode(doc).child(0).child(1).type.name).toBe('tableHeader');
    expect(tableNode(doc).child(1).child(1).type.name).toBe('tableCell');
    expect(colwidths(doc).map((row) => [row[0], row[2]])).toEqual([
      [[120], [240]],
      [[120], [240]],
      [[120], [240]],
    ]);

    editBlock(doc, id, { type: 'delete_column', at: 0 });
    expect(noteBlocks(doc)[1].rows).toEqual([
      ['', 'Plan'],
      ['', 'Rest'],
      ['', 'Walk'],
    ]);
    expect(cellEls(doc).map((row) => itemIds(row[1]))).toEqual(before.map((row) => row[1]));
  });

  it('should merge a cell edit with a human typing in another cell', () => {
    const agent = tableDoc();
    const human = reload(agent);
    editBlock(agent, tableId(agent), { type: 'set_cell', row: 1, col: 1, markdown: 'Hike' });
    ((cellEls(human)[2][1].get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(4, 'ing');
    sync(agent, human);
    expect(noteBlocks(agent)[1].rows?.slice(1)).toEqual([
      ['Mon', 'Hike'],
      ['Tue', 'Walking'],
    ]);
  });

  it('should refuse out-of-range indexes, the last row or column, and non-table blocks', () => {
    const doc = createDoc('| A |\n| --- |\n| 1 |\n\nText');
    const [table, text] = ids(doc);
    expect(() => editBlock(doc, table, { type: 'set_cell', row: 5, col: 0, markdown: 'x' })).toThrow('row 5 is out of range 0–1');
    expect(() => editBlock(doc, table, { type: 'delete_column', at: 0 })).toThrow('only column');
    expect(() => editBlock(doc, text, { type: 'insert_row', at: 0 })).toThrow('insert_row works on a table; this block is a paragraph');
  });

  it('should refuse row and column ops on a table with merged cells', () => {
    const doc = docFromJSON([
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [para('Both')] }] },
          { type: 'tableRow', content: [cell('tableCell', 'a', [100]), cell('tableCell', 'b', [100])] },
        ],
      },
    ]);
    expect(() => editBlock(doc, ids(doc)[0], { type: 'insert_column', at: 0 })).toThrow('merged cells');
  });
});
