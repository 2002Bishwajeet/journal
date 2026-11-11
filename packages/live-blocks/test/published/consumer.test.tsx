// @vitest-environment happy-dom
/**
 * The published build, as a host that is not Journal uses it (#1075): `npm run build` first.
 * No Vite plugin and no app state, only `dist/`: every kind renders, and the entry holds no
 * library a block may import.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveBlock, parseCodeInfo } from '../../dist/index.js';

const DIST = path.resolve(import.meta.dirname, '../../dist');

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let host: HTMLDivElement;

async function render(kind: 'html' | 'react' | 'mermaid' | 'svg', source: string): Promise<void> {
  host = document.body.appendChild(document.createElement('div'));
  const mounted = (root = createRoot(host));
  await act(async () => mounted.render(<LiveBlock kind={kind} source={source} />));
  for (let i = 0; i < 500 && host.querySelector('[role="status"]'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
});

const srcdoc = () => host.querySelector('iframe')!.getAttribute('srcdoc')!;

describe('the built package', () => {
  it('should read a fence', () => {
    expect(parseCodeInfo('react wide id=k3f9')).toEqual({ language: 'react', id: 'k3f9', wide: true });
  });

  it('should render an html block in its sandboxed frame', async () => {
    await render('html', '<p id="hello">Hello</p>');
    expect(host.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
    expect(srcdoc()).toContain('<p id="hello">Hello</p>');
  });

  it('should render a react block on the built React runtime and Tailwind sheet', async () => {
    await render('react', "import { LineChart } from 'recharts';\nfunction App() { return <p className=\"text-sm\">{typeof LineChart}</p>; }");
    expect(host.querySelector('iframe')!.getAttribute('title')).toBe('React preview');
    expect(srcdoc()).toContain('window.ReactDOM = Object.assign');
    expect(srcdoc()).toContain('.text-sm{');
    // The Recharts it imports, in Journal's theme.
    expect(srcdoc()).toContain('var Recharts');
  });

  it('should render a mermaid block on the built mermaid runtime', async () => {
    await render('mermaid', 'graph TD; A-->B');
    expect(host.querySelector('iframe')!.getAttribute('title')).toBe('Mermaid preview');
    expect(srcdoc()).toContain('Inter Variable');
    expect(srcdoc()).toContain(JSON.stringify('graph TD; A-->B'));
  });

  it('should render an svg block as an image', async () => {
    await render('svg', "<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(host.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('should keep every library, the runtimes and the compiler out of the entry', () => {
    const entry = readFileSync(path.join(DIST, 'index.js'), 'utf8');
    // Each a chunk of its own, imported only when a block needs it (Tailwind's theme is in the compiler's).
    for (const piece of ['three', 'd3', 'recharts', 'mathjs', 'lodash', 'papaparse', 'lucide', 'ui', 'mermaid', 'runtime', 'tailwind']) {
      expect(entry).toMatch(new RegExp(`import\\("\\./_virtual_react-block-${piece}-[\\w-]+\\.js"\\)`));
    }
    expect(entry).toMatch(/import\("\.\/reactBlockCompiler-[\w-]+\.js"\)/);
    expect(entry.length).toBeLessThan(100_000);
    expect(readdirSync(DIST).filter((file) => file.startsWith('_virtual_react-block-'))).toHaveLength(11);
  });
});
