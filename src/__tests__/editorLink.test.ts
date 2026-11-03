// @vitest-environment happy-dom
/** #827: the link sheet's helpers: the target under the caret, the https default, apply and remove. */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { applyLink, getLinkTarget, normalizeHref, removeLink } from '@/lib/editor/editorLink';

let editor: Editor;

function mkEditor(content: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: createBaseExtensions(), content });
  return editor;
}

afterEach(() => editor?.destroy());

const html = () => editor.getHTML();

describe('normalizeHref', () => {
  it('adds https:// to a bare host and keeps a scheme, a path or a fragment', () => {
    expect(normalizeHref(' example.com ')).toBe('https://example.com');
    expect(normalizeHref('http://example.com')).toBe('http://example.com');
    expect(normalizeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(normalizeHref('/notes/1')).toBe('/notes/1');
    expect(normalizeHref('#top')).toBe('#top');
  });
});

describe('getLinkTarget', () => {
  it('returns the selected word with no link', () => {
    mkEditor('<p>Hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(getLinkTarget(editor)).toEqual({ from: 1, to: 6, text: 'Hello', href: '' });
  });

  it('returns the whole link when the caret is inside it', () => {
    mkEditor('<p>See <a href="https://a.test">the docs</a> now</p>');
    editor.commands.setTextSelection(8);
    expect(getLinkTarget(editor)).toEqual({ from: 5, to: 13, text: 'the docs', href: 'https://a.test' });
  });
});

describe('applyLink', () => {
  it('links the selected word and keeps its text', () => {
    mkEditor('<p>Hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, getLinkTarget(editor), 'Hello', 'example.com');
    expect(html()).toContain('href="https://example.com"');
    expect(editor.state.doc.textContent).toBe('Hello world');
  });

  it('replaces the text when the Text field changed', () => {
    mkEditor('<p>Hello world</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, getLinkTarget(editor), 'Hi', 'https://a.test');
    expect(editor.state.doc.textContent).toBe('Hi world');
    expect(html()).toContain('>Hi</a>');
  });

  it('inserts the URL as the text when nothing is selected and the Text field is empty', () => {
    mkEditor('<p>Hello</p>');
    editor.commands.setTextSelection(6);
    applyLink(editor, getLinkTarget(editor), '', 'https://a.test');
    expect(editor.state.doc.textContent).toBe('Hellohttps://a.test');
  });

  it('changes the URL of the link under the caret', () => {
    mkEditor('<p>See <a href="https://a.test">the docs</a> now</p>');
    editor.commands.setTextSelection(8);
    const target = getLinkTarget(editor);
    applyLink(editor, target, target.text, 'https://b.test');
    expect(html()).toContain('href="https://b.test"');
    expect(html()).not.toContain('https://a.test');
  });
});

describe('removeLink', () => {
  it('removes the whole link and keeps its text', () => {
    mkEditor('<p>See <a href="https://a.test">the docs</a> now</p>');
    editor.commands.setTextSelection(8);
    removeLink(editor, getLinkTarget(editor));
    expect(html()).not.toContain('<a ');
    expect(editor.state.doc.textContent).toBe('See the docs now');
  });
});
