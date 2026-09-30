import { describe, it, expect } from 'vitest';
import { codeBlockFromPaste } from '@/components/editor/plugins/extensions';

describe('codeBlockFromPaste', () => {
    it('should turn one fenced block into its language and code', () => {
        expect(codeBlockFromPaste('```html\n<div>Hi</div>\n```')).toEqual({ language: 'html', code: '<div>Hi</div>' });
        expect(codeBlockFromPaste('```mermaid\r\ngraph TD; A-->B\r\n```\n')).toEqual({
            language: 'mermaid',
            code: 'graph TD; A-->B',
        });
        expect(codeBlockFromPaste('```\nplain\n```')).toEqual({ language: null, code: 'plain' });
    });

    it('should leave several fenced blocks alone', () => {
        expect(codeBlockFromPaste('```js\na\n```\ntext\n```js\nb\n```')).toBeNull();
    });

    it('should treat bare markup as html, or svg when the root is <svg>', () => {
        const html = '<div style="padding:16px">\n  <h2>Hello</h2>\n</div>';
        expect(codeBlockFromPaste(html)).toEqual({ language: 'html', code: html });
        expect(codeBlockFromPaste('<!DOCTYPE html><html><body>x</body></html>')?.language).toBe('html');
        expect(codeBlockFromPaste('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')?.language).toBe('svg');
    });

    it('should leave prose, JSX and unclosed markup as text', () => {
        expect(codeBlockFromPaste('Just a sentence with <b>bold</b> in it.')).toBeNull();
        expect(codeBlockFromPaste('<Component prop="x"></Component>')).toBeNull();
        expect(codeBlockFromPaste('<div>never closed')).toBeNull();
        expect(codeBlockFromPaste('a < b and b > c')).toBeNull();
        expect(codeBlockFromPaste('')).toBeNull();
    });
});
