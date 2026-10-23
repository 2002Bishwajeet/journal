// @vitest-environment happy-dom
/**
 * #673: the highlight.js grammars load only once a note has a code block, and the
 * highlights then draw without a doc change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import type * as Extensions from '@/components/editor/plugins/extensions';

const grammarsImported = vi.hoisted(() => vi.fn());
// Counts reads of `common`, once per load: the mocked module itself is cached across vi.resetModules().
vi.mock('@/components/editor/plugins/lowlightGrammars', async (importOriginal) => {
  const { common } = await importOriginal<typeof import('@/components/editor/plugins/lowlightGrammars')>();
  return {
    get common() {
      grammarsImported();
      return common;
    },
  };
});

// Each test gets a fresh extensions module, so the grammars start unloaded.
let extensions: typeof Extensions;
let editor: Editor | undefined;

beforeEach(async () => {
  vi.resetModules();
  grammarsImported.mockClear();
  extensions = await import('@/components/editor/plugins/extensions');
});

afterEach(() => editor?.destroy());

function mkEditor(content: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor = new Editor({ element: el, extensions: extensions.createBaseExtensions(), content });
  return el;
}

describe('docHasCodeBlock', () => {
  it('finds a code block at the top level or nested, and nothing in prose', () => {
    const schema = getSchema(extensions.createBaseExtensions());
    const text = (value: string) => ({ type: 'text', text: value });
    const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });
    const code = { type: 'codeBlock', content: [text('x')] };
    const has = (content: object[]) => extensions.docHasCodeBlock(schema.nodeFromJSON({ type: 'doc', content }));

    expect(has([paragraph('Just prose'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('a list')] }] }])).toBe(false);
    expect(has([paragraph('Intro'), code])).toBe(true);
    expect(has([{ type: 'blockquote', content: [code] }])).toBe(true);
  });
});

describe('lazy code highlighting', () => {
  it('a prose note never loads the grammars', async () => {
    mkEditor('<p>Only prose here.</p>');
    editor!.commands.insertContent(' More prose.');
    await new Promise((r) => setTimeout(r, 50));
    expect(grammarsImported).not.toHaveBeenCalled();
  });

  it('highlights a note that opens with a code block, without changing its doc', async () => {
    // The trailing paragraph is there already, so no transaction appends one.
    const el = mkEditor('<p>Intro</p><pre><code class="language-ts">const a: number = 1;</code></pre><p></p>');
    const update = vi.fn();
    editor!.on('update', update);
    const docBefore = editor!.state.doc;
    // Plain text until the grammars arrive.
    expect(el.querySelector('[class*="hljs-"]')).toBeNull();

    await vi.waitFor(() => expect(el.querySelector('pre .hljs-keyword')?.textContent).toBe('const'));
    expect(grammarsImported).toHaveBeenCalledTimes(1);
    expect(editor!.state.doc).toBe(docBefore);
    expect(update).not.toHaveBeenCalled();
  });

  it('loads the grammars when a code block is inserted into a prose note', async () => {
    const el = mkEditor('<p>Only prose here.</p>');
    await new Promise((r) => setTimeout(r, 0));
    expect(grammarsImported).not.toHaveBeenCalled();

    editor!.commands.insertContent({ type: 'codeBlock', attrs: { language: 'react' }, content: [{ type: 'text', text: 'function App() { return null; }' }] });
    await vi.waitFor(() => expect(el.querySelector('pre .hljs-keyword')?.textContent).toBe('function'));
    expect(grammarsImported).toHaveBeenCalledTimes(1);
  });
});
