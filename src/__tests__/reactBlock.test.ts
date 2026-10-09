// @vitest-environment happy-dom
/**
 * A `react` live block (#426): its JSX is compiled in the app (compileReactBlock), and
 * reactBlockDocument puts the compiled component and the app's own React runtime into the
 * html document that buildSrcdoc wraps. The documents here run on the React these tests
 * import, standing in for the runtime vite.config.ts builds from the same package (the e2e
 * spec e2e/editor/live-react.spec.ts runs the real one in its sandboxed frame).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { compileReactBlock, reactBlockImports } from '@/lib/reactBlockCompiler';
import { reactBlockDocument } from '@/lib/liveBlocks';

// The same counter the e2e spec types, pastes and publishes.
const COUNTER = [
  'function App() {',
  '  const [count, setCount] = useState(0);',
  '  return (',
  '    <div>',
  '      <p>Count: {count}</p>',
  '      <button onClick={() => setCount(count + 1)}>Add one</button>',
  '    </div>',
  '  );',
  '}',
].join('\n');

/** What the runtime script does: set the globals the component runs on. */
const RUNTIME = 'window.React = window.__testReact; window.ReactDOM = window.__testReactDOM;';
/** Stands in for the Tailwind sheet vite.config.ts builds. */
const SHEET = '.marker-utility{color:red}';
/** Stands in for lucide-react: one icon, drawn as an svg with a title. */
const LUCIDE = "window.LucideReact = { Heart: function (props) { return React.createElement('svg', { 'data-icon': 'heart', className: props.className }); } };";

type TestWindow = Window & { __testReact?: unknown; __testReactDOM?: unknown; React?: unknown; ReactDOM?: unknown; LucideReact?: unknown };

function compiled(source: string): string {
  const result = compileReactBlock(source);
  if ('error' in result) throw new Error(result.error);
  return result.code;
}

/**
 * Puts the document's markup in the page and runs its scripts in order, the way a browser
 * does: a script that throws stops, and the error is dispatched on the window.
 */
function load(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = [...parsed.querySelectorAll('script')].map((script) => script.textContent ?? '');
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  for (const script of scripts) {
    try {
      // Indirect eval: the script runs in the global scope, like a classic <script>.
      (0, eval)(script);
    } catch (error) {
      window.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));
    }
  }
}

const rootText = () => document.getElementById('root')?.textContent;
const alertText = () => document.querySelector('[role="alert"]:not([hidden])')?.textContent ?? null;

describe('compileReactBlock', () => {
  it('should turn JSX into React.createElement calls', () => {
    const code = compiled(COUNTER);
    expect(code).toContain("React.createElement('button'");
    expect(code).not.toMatch(/<\/?(div|p|button)\b/);
  });

  it('should compile for production: no __self or __source props', () => {
    expect(compiled(COUNTER)).not.toMatch(/__self|__source/);
  });

  it('should turn a default export into exports.default', () => {
    expect(compiled('export default function Counter() { return <p>hi</p>; }')).toContain('exports.default = Counter');
  });

  it('should report a syntax error as its line and message, as text', () => {
    expect(compileReactBlock('function App() {\n  return <div>;\n}')).toEqual({ error: 'Line 2: Unterminated JSX contents' });
    expect(compileReactBlock('const n: number = 1;')).toEqual({ error: 'Line 1: Unexpected token, expected ";"' });
  });
});

describe('reactBlockImports (#427)', () => {
  it('should list each module the block imports, once, in order', () => {
    const code = compiled(
      [
        "import React, { useState } from 'react';",
        'import { Heart } from "lucide-react";',
        "import * as Charts from 'recharts';",
        "import { Star } from 'lucide-react';",
        'function App() { return <Heart />; }',
      ].join('\n'),
    );
    expect(reactBlockImports(code)).toEqual(['react', 'lucide-react', 'recharts']);
  });

  it('should list a module that is not allowed, and one imported for its side effects or dynamically', () => {
    expect(reactBlockImports(compiled("import x from 'd3';\nimport 'left-pad';\nconst later = import('lodash');"))).toEqual(['d3', 'left-pad', 'lodash']);
  });

  it('should list nothing for a block without imports', () => {
    expect(reactBlockImports(compiled(COUNTER))).toEqual([]);
  });
});

describe('reactBlockDocument', () => {
  it('should hold a root, then the runtime and the component, each in an inline script', () => {
    const html = reactBlockDocument({ react: RUNTIME, tailwind: SHEET }, 'var marker = 1;');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.getElementById('root')).not.toBeNull();
    const scripts = [...parsed.querySelectorAll('script')];
    expect(scripts.every((script) => !script.hasAttribute('src'))).toBe(true);
    const texts = scripts.map((script) => script.textContent ?? '');
    const runtimeAt = texts.findIndex((text) => text === RUNTIME);
    const componentAt = texts.findIndex((text) => text.includes('var marker = 1;'));
    expect(runtimeAt).toBeGreaterThanOrEqual(0);
    expect(componentAt).toBeGreaterThan(runtimeAt);
  });

  it('should start with the Tailwind sheet as one style, before the root and every script (#427)', () => {
    const html = reactBlockDocument({ react: RUNTIME, tailwind: SHEET }, 'var marker = 1;');
    expect(html.startsWith(`<style>${SHEET}</style><div id="root"></div>`)).toBe(true);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toContain('journal-block-tailwind');
  });

  it("should put the block's own Tailwind right after the sheet, and keep a closing style tag in it from ending its style (#559)", () => {
    const html = reactBlockDocument({ react: RUNTIME, tailwind: SHEET }, 'var marker = 1;', ".a{content:'</style><b>'}");
    expect(html.startsWith(`<style>${SHEET}</style><style id="journal-block-tailwind">.a{content:'<\\/style><b>'}</style><div id="root"></div>`)).toBe(true);
  });

  it('should hold the libraries only when they are passed, in order, between React and the component (#427)', () => {
    const RECHARTS = 'window.Recharts = {};';
    const scripts = (html: string) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script')].map((script) => script.textContent ?? '');
    expect(scripts(reactBlockDocument({ react: RUNTIME, tailwind: SHEET }, 'var marker = 1;')).filter((text) => /Recharts =|LucideReact =/.test(text))).toEqual([]);

    const texts = scripts(reactBlockDocument({ react: RUNTIME, tailwind: SHEET, libraries: [RECHARTS, LUCIDE] }, 'var marker = 1;'));
    const at = (needle: string) => texts.findIndex((text) => text.includes(needle));
    expect(at(RUNTIME)).toBeLessThan(at(RECHARTS));
    expect(at(RECHARTS)).toBeLessThan(at(LUCIDE));
    expect(at(LUCIDE)).toBeLessThan(at('var marker = 1;'));
  });

  it('should keep a closing script tag in the runtime or the component from ending its script', () => {
    const runtime = `${RUNTIME} window.runtimeText = "</script><p id=injected>";`;
    const code = 'window.componentText = "</SCRIPT>" + "<!--";';
    const parsed = new DOMParser().parseFromString(reactBlockDocument({ react: runtime, tailwind: SHEET }, code), 'text/html');
    expect(parsed.getElementById('injected')).toBeNull();
    const texts = [...parsed.querySelectorAll('script')].map((script) => script.textContent ?? '');
    expect(texts.some((text) => text.includes('window.runtimeText = "\\x3C/script>'))).toBe(true);
    expect(texts.some((text) => text.includes('window.componentText = "\\x3C/SCRIPT>" + "\\x3C!--"'))).toBe(true);
  });

  describe('run', () => {
    const win = window as TestWindow;

    beforeAll(() => {
      (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      win.__testReact = React;
      win.__testReactDOM = ReactDOMClient;
    });

    afterAll(() => {
      delete win.__testReact;
      delete win.__testReactDOM;
      delete win.React;
      delete win.ReactDOM;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    // Each page's error listener stays on the shared test window, but only writes into its own
    // page's error box, which the next page replaces.
    const run = (source: string) => act(async () => load(reactBlockDocument({ react: RUNTIME, tailwind: SHEET }, compiled(source))));

    it('should render App with the hooks available bare, and update on a click', async () => {
      await run(COUNTER);
      expect(rootText()).toContain('Count: 0');
      await act(async () => document.querySelector('button')!.click());
      expect(rootText()).toContain('Count: 1');
      expect(alertText()).toBeNull();
    });

    it('should render a default export, and a component that imports its hooks from react', async () => {
      await run(
        "import { useReducer } from 'react';\nexport default function Tally() { const [n, add] = useReducer((x) => x + 1, 2); return <button onClick={add}>n = {n}</button>; }",
      );
      expect(rootText()).toContain('n = 2');
      await act(async () => document.querySelector('button')!.click());
      expect(rootText()).toContain('n = 3');
    });

    it('should let a component take its hooks from React itself, under the same names', async () => {
      await run('const { useState } = React;\nfunction App() { const [on] = useState(true); return <p>{on ? "on" : "off"}</p>; }');
      expect(rootText()).toBe('on');
      expect(alertText()).toBeNull();
    });

    it('should show the message of a component that throws while rendering', async () => {
      await run("function App() { throw new Error('The counter broke'); }");
      expect(alertText()).toContain('The counter broke');
    });

    it('should say what is missing when the source defines no App and exports nothing', async () => {
      await run('function Counter() { return <p>hi</p>; }');
      expect(alertText()).toContain('Define a component named App');
    });

    it('should render an icon imported from lucide-react, when the page holds it (#427)', async () => {
      const source = "import { Heart } from 'lucide-react';\nfunction App() { return <p><Heart className=\"size-4\" /> Liked</p>; }";
      await act(async () => load(reactBlockDocument({ react: RUNTIME, tailwind: SHEET, libraries: [LUCIDE] }, compiled(source))));
      expect(document.querySelector('#root svg[data-icon="heart"]')?.getAttribute('class')).toBe('size-4');
      expect(alertText()).toBeNull();
      delete win.LucideReact;
    });

    it('should give a block each library under its import name: a namespace, named imports, and lodash default-imported under either name (#558)', async () => {
      // Stand-ins for the scripts vite.config.ts builds: each sets the global REACT_BLOCK_LIBRARIES names.
      const D3 = "window.d3 = { version: '7' };";
      const LODASH = "window.lodash = { __esModule: true, default: { chunk: function (list) { return [list]; } }, sum: function (list) { return list.length; } };";
      const MATH = "window.math = { evaluate: function () { return 4; } };";
      const source = [
        "import * as d3 from 'd3';",
        "import _ from 'lodash';",
        "import { sum } from 'lodash-es';",
        "import { evaluate } from 'mathjs';",
        "function App() { return <p>{d3.version} {_.chunk([1]).length} {sum([1, 2])} {evaluate('2 + 2')}</p>; }",
      ].join('\n');
      await act(async () => load(reactBlockDocument({ react: RUNTIME, tailwind: SHEET, libraries: [D3, LODASH, MATH] }, compiled(source))));
      expect(rootText()).toBe('7 1 2 4');
      expect(alertText()).toBeNull();
      for (const name of ['d3', 'lodash', 'math']) delete (win as unknown as Record<string, unknown>)[name];
    });

    it('should name the module and the allowed ones when a block imports anything else (#427, #558)', async () => {
      await run("import axios from 'axios';\nfunction App() { return <p>{axios.VERSION}</p>; }");
      expect(alertText()).toContain(
        'A react block can import only react, recharts, lucide-react, d3, three, lodash-es, lodash, mathjs, papaparse and journal-ui, not axios.',
      );
      expect(rootText()).toBe('');
    });

    it('should not hand out a library that is allowed but not on the page (#558)', async () => {
      await run("import * as THREE from 'three';\nfunction App() { return <p>{THREE.REVISION}</p>; }");
      expect(alertText()).toContain('not three.');
    });
  });
});
