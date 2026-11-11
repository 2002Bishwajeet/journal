// @vitest-environment happy-dom
/**
 * The pieces of a block's page load only when a block needs them (#1075): importing the
 * package loads none, a react block loads the libraries it imports and no others, and the
 * mermaid runtime loads for a mermaid block.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const loaded = vi.hoisted(() => new Set<string>());
const piece = (name: string) => {
  loaded.add(name);
  return { default: `/* ${name} */` };
};
vi.mock('virtual:react-block-runtime', () => piece('runtime'));
vi.mock('virtual:react-block-tailwind', () => piece('tailwind'));
vi.mock('virtual:react-block-mermaid', () => piece('mermaid'));
vi.mock('virtual:react-block-recharts', () => piece('recharts'));
vi.mock('virtual:react-block-lucide', () => piece('lucide'));
vi.mock('virtual:react-block-d3', () => piece('d3'));
vi.mock('virtual:react-block-three', () => piece('three'));
vi.mock('virtual:react-block-lodash', () => piece('lodash'));
vi.mock('virtual:react-block-mathjs', () => piece('mathjs'));
vi.mock('virtual:react-block-papaparse', () => piece('papaparse'));
vi.mock('virtual:react-block-ui', () => piece('journal-ui'));

// A piece's module loads once: each test sees what it loaded itself.
beforeEach(() => loaded.clear());

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function show(kind: 'react' | 'mermaid', source: string): Promise<string> {
  const { LiveBlock } = await import('../src/index');
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => root.render(<LiveBlock kind={kind} source={source} />));
  for (let i = 0; i < 200 && host.querySelector('[role="status"]'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  const srcdoc = host.querySelector('iframe')!.getAttribute('srcdoc')!;
  await act(async () => root.unmount());
  host.remove();
  return srcdoc;
}

describe('the pieces of a block\'s page', () => {
  it('should load none when the package is imported', async () => {
    await import('../src/index');
    expect([...loaded]).toEqual([]);
  });

  it('should load, for a react block, React, the sheet and only the libraries it imports', async () => {
    const srcdoc = await show('react', "import * as THREE from 'three';\nfunction App() { return <p>{THREE.REVISION}</p>; }");
    expect([...loaded].sort()).toEqual(['runtime', 'tailwind', 'three']);
    expect(srcdoc).toContain('<script>/* three */</script>');
  });

  it('should load the mermaid runtime for a mermaid block', async () => {
    await show('mermaid', 'graph TD; A-->B');
    expect([...loaded]).toEqual(['mermaid']);
  });
});
