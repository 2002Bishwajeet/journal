import type { FrameLocator, Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #558: a react block can import d3, three, lodash, mathjs, papaparse and journal-ui (a UI kit in
// Journal's theme). Each library is a script the app loads from its own origin only for a block
// that imports it, inlined into the block's sandboxed frame, which makes no request of its own.

const D3_CHART = [
  "import * as d3 from 'd3';",
  '',
  "const data = [{ day: 'Mon', words: 420 }, { day: 'Tue', words: 380 }, { day: 'Wed', words: 610 }, { day: 'Thu', words: 540 }];",
  '',
  'export default function App() {',
  '  const ref = useRef(null);',
  '  useEffect(() => {',
  '    const width = 400, height = 160;',
  "    const x = d3.scaleBand().domain(data.map((d) => d.day)).range([0, width]).padding(0.2);",
  '    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.words)]).range([height, 0]);',
  "    const svg = d3.select(ref.current).attr('viewBox', `0 0 ${width} ${height}`);",
  "    svg.selectAll('rect').data(data).join('rect')",
  "      .attr('x', (d) => x(d.day)).attr('y', (d) => y(d.words))",
  "      .attr('width', x.bandwidth()).attr('height', (d) => height - y(d.words))",
  "      .attr('fill', 'var(--chart-2)');",
  '  }, []);',
  '  return <svg id="d3-chart" ref={ref} className="w-full" />;',
  '}',
].join('\n');

const THREE_CUBE = [
  "import * as THREE from 'three';",
  '',
  'export default function App() {',
  '  const ref = useRef(null);',
  '  useEffect(() => {',
  '    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });',
  '    renderer.setSize(320, 200);',
  '    ref.current.appendChild(renderer.domElement);',
  '    const scene = new THREE.Scene();',
  '    const camera = new THREE.PerspectiveCamera(50, 320 / 200, 0.1, 100);',
  '    camera.position.z = 3;',
  '    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial());',
  '    scene.add(cube);',
  '    window.cube = cube;',
  '    let frame;',
  '    const spin = () => { cube.rotation.x += 0.02; cube.rotation.y += 0.03; renderer.render(scene, camera); frame = requestAnimationFrame(spin); };',
  '    spin();',
  '    return () => { cancelAnimationFrame(frame); renderer.dispose(); };',
  '  }, []);',
  '  return <div id="three-cube" ref={ref} />;',
  '}',
].join('\n');

const PAPA_TABLE = [
  "import Papa from 'papaparse';",
  '',
  "const csv = 'mood,days\\ncalm,12\\nbusy,9\\n\"tired, but ok\",4';",
  '',
  'export default function App() {',
  '  const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });',
  '  return (',
  '    <table id="papa-table">',
  '      <thead><tr><th>Mood</th><th>Days</th></tr></thead>',
  '      <tbody>{data.map((row) => <tr key={row.mood}><td>{row.mood}</td><td>{row.days}</td></tr>)}</tbody>',
  '    </table>',
  '  );',
  '}',
].join('\n');

const MATHJS = [
  "import { evaluate, format } from 'mathjs';",
  "import _ from 'lodash';",
  '',
  'export default function App() {',
  "  const [expr, setExpr] = useState('sqrt(16) + 2^3');",
  '  return (',
  '    <div>',
  '      <input aria-label="Expression" value={expr} onChange={(e) => setExpr(e.target.value)} />',
  "      <p id=\"math-result\">= {format(evaluate(expr), { precision: 4 })}</p>",
  "      <p id=\"lodash-result\">{_.chunk([1, 2, 3, 4, 5], 2).map((pair) => pair.join('+')).join(' | ')}</p>",
  '    </div>',
  '  );',
  '}',
].join('\n');

const UI_KIT = [
  "import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Tabs, TabsList, TabsTrigger, TabsContent, Input, Select, SelectItem, Slider, Switch, Badge, Progress } from 'journal-ui';",
  '',
  'export default function App() {',
  '  const [goal, setGoal] = useState([60]);',
  '  const [daily, setDaily] = useState(true);',
  '  return (',
  '    <Card id="kit">',
  '      <CardHeader>',
  '        <CardTitle>Writing goal</CardTitle>',
  '        <CardDescription>Words a day, this month</CardDescription>',
  '      </CardHeader>',
  '      <CardContent className="space-y-4">',
  '        <Tabs defaultValue="week">',
  '          <TabsList>',
  '            <TabsTrigger value="week">Week</TabsTrigger>',
  '            <TabsTrigger value="month">Month</TabsTrigger>',
  '          </TabsList>',
  '          <TabsContent value="week">Seven days of notes.</TabsContent>',
  '          <TabsContent value="month">Thirty days of notes.</TabsContent>',
  '        </Tabs>',
  '        <div className="flex items-center gap-2">',
  '          <Input placeholder="Name this goal" />',
  '          <Select defaultValue="calm" aria-label="Mood">',
  '            <SelectItem value="calm">Calm</SelectItem>',
  '            <SelectItem value="busy">Busy</SelectItem>',
  '          </Select>',
  '        </div>',
  '        <Slider aria-label="Goal" value={goal} onValueChange={setGoal} />',
  '        <Progress value={goal[0]} />',
  '        <label className="flex items-center gap-2 text-sm">',
  '          <Switch aria-label="Every day" checked={daily} onCheckedChange={setDaily} /> Every day',
  '        </label>',
  '        <div className="flex gap-2">',
  '          <Badge>{goal[0]}%</Badge>',
  '          <Badge variant="secondary">Daily</Badge>',
  '          <Badge variant="outline">Draft</Badge>',
  '        </div>',
  '      </CardContent>',
  '      <CardFooter>',
  '        <Button id="save">Save</Button>',
  '        <Button variant="outline">Cancel</Button>',
  '        <Button variant="ghost">Reset</Button>',
  '      </CardFooter>',
  '    </Card>',
  '  );',
  '}',
].join('\n');

const COUNTER = 'function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>Count: {n}</button>; }';

// A library's chunk, as the preview build (`_virtual_react-block-d3-<hash>.js`) and the dev server name it.
const LIBRARY_URL = /react-block-(d3|three|lodash|mathjs|papaparse|ui|recharts|lucide)\b/;

const reactFrame = (page: Page, index: number): FrameLocator =>
  activeEditor(page).locator('[data-live-block="react"]').nth(index).frameLocator('iframe[title="React preview"]');

/** True for a request made by a frame inside the page, rather than by the page itself. */
function fromFrame(request: Request): boolean {
  try {
    return request.frame().parentFrame() !== null;
  } catch {
    // A service worker's own request has no frame.
    return false;
  }
}

/** Pastes `source` as a react block on a new line; a pasted block opens in Preview. */
async function pasteBlock(page: Page, source: string): Promise<void> {
  await page.keyboard.press('Enter');
  await pastePlainText(page, '```react\n' + source + '\n```');
}

/** Pastes the sources as react blocks, in order, on a new line: as html code blocks, the way a page copies them. */
async function pasteBlocks(page: Page, sources: string[]): Promise<void> {
  await page.keyboard.press('Enter');
  await assertTestOrigin(page);
  const escape = (code: string) => code.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  await activeEditor(page).evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, sources.map((source) => `<pre><code class="language-react">${escape(source)}</code></pre>`).join(''));
}

/** The libraries the app has requested so far, by name. */
const librariesRequested = (requests: Request[]) => [...new Set(requests.flatMap((request) => LIBRARY_URL.exec(request.url())?.[1] ?? []))].sort();

/** Screenshots the page with block `index` in view, once its frame has painted twice. */
async function shoot(page: Page, index: number, name: string): Promise<void> {
  await activeEditor(page).locator('[data-live-block="react"]').nth(index).scrollIntoViewIfNeeded();
  await reactFrame(page, index).locator('body').evaluate(() => new Promise<void>((painted) => requestAnimationFrame(() => requestAnimationFrame(() => painted()))));
  await page.screenshot({ path: test.info().outputPath(name) });
}

for (const theme of ['light', 'dark'] as const) {
  test(`react block libraries: a d3 chart, a three.js cube, a papaparse table and mathjs with lodash, each loaded only when imported, ${theme} theme`, async ({ app }) => {
    const requests: Request[] = [];
    app.on('request', (request) => requests.push(request));
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `React counter ${theme} ${Date.now()}`, body: 'Intro' });
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    // A block that imports only react loads no library.
    await pasteBlock(app, COUNTER);
    await expect(reactFrame(app, 0).getByRole('button', { name: 'Count: 0' })).toBeVisible();
    expect(librariesRequested(requests)).toEqual([]);

    await createNote(app, { title: `React libraries ${theme} ${Date.now()}`, body: 'Intro' });
    await pasteBlocks(app, [D3_CHART, THREE_CUBE, PAPA_TABLE, MATHJS]);
    await expect(activeEditor(app).locator('[data-live-block="react"]')).toHaveCount(4);

    await expect(reactFrame(app, 0).locator('#d3-chart rect')).toHaveCount(4);

    const cube = reactFrame(app, 1);
    await expect(cube.locator('#three-cube canvas')).toBeVisible();
    // The cube spins: its rotation grows from one frame to the next, drawn by WebGL.
    const rotation = () => cube.locator('body').evaluate(() => (window as unknown as { cube: { rotation: { y: number } } }).cube.rotation.y);
    const first = await rotation();
    await expect.poll(rotation).toBeGreaterThan(first);
    expect(await cube.locator('canvas').evaluate((canvas: HTMLCanvasElement) => !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl')))).toBe(true);

    const table = reactFrame(app, 2).locator('#papa-table');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('tbody tr').nth(2)).toHaveText('tired, but ok4');

    const math = reactFrame(app, 3);
    await expect(math.locator('#math-result')).toHaveText('= 12');
    await expect(math.locator('#lodash-result')).toHaveText('1+2 | 3+4 | 5');
    await math.getByRole('textbox', { name: 'Expression' }).fill('1/3');
    await expect(math.locator('#math-result')).toHaveText('= 0.3333');

    // Each library came from the app's origin when a block first imported it; no frame made a request.
    expect(librariesRequested(requests)).toEqual(['d3', 'lodash', 'mathjs', 'papaparse', 'three']);
    const origin = new URL(app.url()).origin;
    expect(requests.filter((request) => LIBRARY_URL.test(request.url())).every((request) => new URL(request.url()).origin === origin)).toBe(true);
    expect(requests.filter(fromFrame).map((request) => request.url())).toEqual([]);

    await shoot(app, 0, `react-d3-${theme}-desktop.png`);
    await shoot(app, 1, `react-three-${theme}-desktop.png`);
    await shoot(app, 3, `react-papaparse-mathjs-${theme}-desktop.png`);
  });

  test(`react block journal-ui: the kit in Journal's theme, and its controls work, ${theme} theme`, async ({ app }) => {
    const requests: Request[] = [];
    app.on('request', (request) => requests.push(request));
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `React UI kit ${theme} ${Date.now()}`, body: 'Intro' });
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));
    await pasteBlock(app, UI_KIT);

    const frame = reactFrame(app, 0);
    await expect(frame.getByText('Writing goal')).toBeVisible();
    expect(librariesRequested(requests)).toEqual(['ui']);

    // Tabs switch their panel.
    await expect(frame.getByRole('tabpanel')).toHaveText('Seven days of notes.');
    await frame.getByRole('tab', { name: 'Month' }).click();
    await expect(frame.getByRole('tabpanel')).toHaveText('Thirty days of notes.');
    // The switch toggles, the slider moves the progress bar and the badge.
    const toggle = frame.getByRole('switch', { name: 'Every day' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await frame.getByRole('slider', { name: 'Goal' }).fill('80');
    await expect(frame.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
    await expect(frame.getByText('80%')).toBeVisible();
    await frame.getByRole('combobox', { name: 'Mood' }).selectOption('busy');
    await expect(frame.getByRole('combobox', { name: 'Mood' })).toHaveValue('busy');

    // Drawn in the theme the frame has: the card on --card, the primary button on --primary.
    const drawn = await frame.locator('#kit').evaluate((card) => {
      const token = (name: string) => {
        const probe = document.body.appendChild(document.createElement('i'));
        probe.style.color = `var(${name})`;
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const save = document.getElementById('save')!;
      return {
        card: [getComputedStyle(card).backgroundColor, token('--card')],
        border: [getComputedStyle(card).borderTopColor, token('--border')],
        save: [getComputedStyle(save).backgroundColor, token('--primary')],
        saveText: [getComputedStyle(save).color, token('--primary-foreground')],
      };
    });
    for (const [actual, expected] of Object.values(drawn)) expect(actual).toBe(expected);
    expect(requests.filter(fromFrame).map((request) => request.url())).toEqual([]);

    await frame.getByRole('tab', { name: 'Week' }).click();
    await shoot(app, 0, `react-journal-ui-${theme}-desktop.png`);
  });
}
