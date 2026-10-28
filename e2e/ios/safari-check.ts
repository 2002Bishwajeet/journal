// Real iOS Safari check (#799): drives the e2e build in Mobile Safari on an iOS
// Simulator through Appium's XCUITest driver, screenshots each flow and fails
// on the layout problems in ./checks.ts. CI only (.github/workflows/ios-safari.yml);
// see "iOS Safari" in e2e/README.md. Run with Node 22.18+ (it strips the types).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { remote } from 'webdriverio';
import {
  gestureProblems,
  layoutProblems,
  measureLayout,
  safeAreaProblem,
  startGestureProbe,
  stopGestureProbe,
  type Gesture,
  type GestureProbe,
  type Layout,
  zoomProblems,
} from './checks.ts';

const BASE = 'http://127.0.0.1:4173';
const OUT = 'test-results/ios-safari';
const TYPED = ['First line', 'Second line', 'Third line'];

const failures: string[] = [];
const warnings: string[] = [];
const summary: string[] = ['| Step | Screenshot | Problems |', '|---|---|---|'];
let shots = 0;

mkdirSync(OUT, { recursive: true });

// WebDriverAgent is prebuilt by the workflow (WDA_DERIVED_DATA), so a session start
// only launches it. A slow start (#843) fails fast and is retried with a fresh session.
const ATTEMPTS = 3;
const capabilities = {
  platformName: 'iOS',
  browserName: 'Safari',
  'appium:automationName': 'XCUITest',
  'appium:udid': process.env.IOS_UDID,
  // Taps are real touches at the element's position, not script clicks: only a
  // real tap brings up the software keyboard.
  'appium:nativeWebTap': true,
  'appium:forceSimulatorSoftwareKeyboardPresence': true,
  ...(process.env.WDA_DERIVED_DATA && { 'appium:usePrebuiltWDA': true, 'appium:derivedDataPath': process.env.WDA_DERIVED_DATA }),
  'appium:wdaLaunchTimeout': 240_000,
  'appium:wdaConnectionTimeout': 240_000,
  'appium:newCommandTimeout': 300,
  // Collects the Safari console for the safariConsole log type (#806).
  'appium:showSafariConsoleLog': true,
};

async function startSession() {
  for (let attempt = 1; ; attempt++) {
    console.log(`Starting the Appium session (attempt ${attempt} of ${ATTEMPTS})`);
    let session: Awaited<ReturnType<typeof remote>> | undefined;
    try {
      const s = await remote({
        hostname: '127.0.0.1',
        port: 4723,
        path: '/',
        logLevel: 'warn',
        connectionRetryTimeout: 240_000,
        connectionRetryCount: 0,
        capabilities,
      });
      session = s;
      // Safari can open before its remote debugger lists any web application.
      await s.waitUntil(async () => (await s.getContexts()).some((c) => String(typeof c === 'string' ? c : c.id).startsWith('WEBVIEW')), {
        timeout: 60_000,
        interval: 2_000,
        timeoutMsg: 'no web view context after 60 s',
      });
      return s;
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${(error as Error).message}`);
      await session?.deleteSession().catch(() => {});
      if (attempt >= ATTEMPTS) throw error;
    }
  }
}

const browser = await startSession();
// Async scripts (the Web Locks query) otherwise time out at once.
await browser.setTimeout({ script: 10_000 });

const screenshot = async (name: string) => {
  const file = `${String(++shots).padStart(2, '0')}-${name}.png`;
  await browser.saveScreenshot(`${OUT}/${file}`);
  return file;
};

// Every mutating script below runs only after this: the job must never drive a real origin.
const assertTestOrigin = (origin: string) => {
  if (origin !== BASE) throw new Error(`Refusing to run on ${origin}`);
};

/** Screenshot the current state and record what is wrong with its layout. */
async function check(name: string, keyboardUp = false): Promise<Layout> {
  const layout = (await browser.execute(measureLayout)) as Layout;
  assertTestOrigin(layout.origin);
  const problems = layoutProblems(layout, keyboardUp);
  const file = await screenshot(name);
  failures.push(...problems.map((p) => `${name}: ${p}`));
  summary.push(`| ${name} | ${file} | ${problems.join('<br>') || 'none'} |`);
  console.log(`${problems.length ? '✗' : '✓'} ${name}${problems.map((p) => `\n    ${p}`).join('')}`);
  return layout;
}

const waitFor = (what: string, condition: () => boolean, timeout = 30_000) =>
  browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg: `timed out waiting for ${what}` });

// A note's Back names its folder ("Back to Main", #825); the list's Back is "Back to notes".
const noteBack = 'button[aria-label^="Back to "]:not([aria-label="Back to notes"])';

async function tap(selector: string, index = 0) {
  // $$ and an index: WebdriverIO 10's $() fails when the selector matches several elements.
  await browser.waitUntil(async () => (await browser.$$(selector)).length > index, { timeout: 30_000, timeoutMsg: `timed out waiting for ${selector}` });
  const el = (await browser.$$(selector))[index];
  await el.waitForDisplayed({ timeout: 30_000 });
  await browser.execute((e) => e.scrollIntoView({ block: 'nearest', inline: 'center' }), el);
  await el.click();
}

async function boot() {
  await browser.url(`${BASE}/`);
  await waitFor(
    'the app to boot',
    () => '__journalE2E' in window && !document.querySelector('[role="progressbar"]') && !!document.querySelector('[aria-label="Sidebar"]'),
    120_000,
  );
}

/** The Safari console since the last call, through Appium's safariConsole log type. */
async function safariConsole(): Promise<string[]> {
  // W3C Appium serves logs at se/log; the legacy route is the fallback.
  for (const route of ['se/log', 'log']) {
    const res = await fetch(`http://127.0.0.1:4723/session/${browser.sessionId}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'safariConsole' }),
    });
    if (res.ok) return ((await res.json()).value as { level: string; message: string }[]).map((e) => `${e.level} ${e.message}`);
  }
  return [];
}

/**
 * Reloads the page and checks the app is ready again within `limit` ms (#806): reloading after
 * typing in the editor once left Safari on the splash screen for minutes. `how` tells a real
 * hang (a manual-style location.reload()) from one only WebDriver's refresh() causes; load-root
 * is WebDriver's navigation to /. Records
 * the boot timing marks (markBoot in src/lib/bootProgress.ts), the console and a screenshot.
 */
async function reloadCheck(how: 'location.reload' | 'webdriver-refresh' | 'load-root', label: string = how, limit = 20_000) {
  const name = `reload-${label}`;
  assertTestOrigin(await browser.execute(() => location.origin));
  await safariConsole().catch(() => []); // drop what came before the reload
  // The marker is gone once the new document has loaded.
  await browser.execute(() => Object.assign(window, { __journalBeforeReload: true }));
  const started = Date.now();
  if (how === 'location.reload') await browser.execute(() => void setTimeout(() => location.reload(), 0));
  else if (how === 'webdriver-refresh') await browser.refresh();
  else await browser.url(`${BASE}/`);
  const problems: string[] = [];
  await waitFor(
    'the app to be ready after the reload',
    () =>
      !('__journalBeforeReload' in window) &&
      '__journalE2E' in window &&
      !document.querySelector('[role="progressbar"], [data-boot-stalled]') &&
      !!document.querySelector('[aria-label="Sidebar"], .ProseMirror'),
    limit,
  ).catch(() => problems.push(`not ready within ${limit / 1000} s of the reload`));
  const elapsed = Date.now() - started;
  const marks = (await browser
    .execute(() =>
      performance
        .getEntriesByType('mark')
        .filter((m) => m.name.startsWith('journal-boot:'))
        .map((m) => `${m.name.slice('journal-boot:'.length)} ${Math.round(m.startTime)}ms`),
    )
    .catch(() => [])) as string[];
  // The Web Locks held and waited for, to tell a lock wait from a slow step.
  const locks = (await browser
    .execute(async () => {
      const q = await navigator.locks.query();
      const names = (list?: LockInfo[]) => (list ?? []).map((l) => `${l.name} (${l.mode}, ${l.clientId})`);
      return [...names(q.held).map((n) => `held ${n}`), ...names(q.pending).map((n) => `pending ${n}`)];
    })
    .catch((e: Error) => [`(no locks: ${e.message})`])) as string[];
  const logs = await safariConsole().catch((e: Error) => [`(no console: ${e.message})`]);
  writeFileSync(`${OUT}/${name}-console.log`, [...locks, ...logs].join('\n'));
  if (problems.length) console.log(`    locks: ${locks.join('; ') || 'none'}`);
  const file = await screenshot(name);
  failures.push(...problems.map((p) => `${name}: ${p}`));
  const timing = `${elapsed}ms; marks: ${marks.join(', ') || 'none'}`;
  summary.push(`| ${name} | ${file} | ${problems.join('<br>') || 'none'} (${timing}) |`);
  console.log(`${problems.length ? '✗' : '✓'} ${name} ${timing}${problems.map((p) => `\n    ${p}`).join('')}`);
}

/** Waits up to 10 s for `text` in the editor; false when it never shows. */
const editorHas = (text: string) =>
  browser
    .waitUntil(() => browser.execute((t) => document.querySelector('.ProseMirror')?.textContent?.includes(t) ?? false, text), { timeout: 10_000, interval: 250 })
    .then(() => true, () => false);

/**
 * Types a new line and reloads at once, then checks the line is still in the note (#873):
 * iOS Safari unloaded the page before the line's write reached the database.
 */
async function typeAndReload(line: string, how: 'location.reload' | 'load-root', label: string) {
  await tap('.ProseMirror');
  await typeOnKeyboard(`\n${line}`);
  if (!(await editorHas(line))) failures.push(`${label}: "${line}" did not show in the editor after typing`);
  await reloadCheck(how, label);
  // A boot slower than 20 s already failed above; judge the text only once the editor is back,
  // so a slow boot is not reported as lost text.
  const back = await waitFor('the editor after the reload', () => !!document.querySelector('.ProseMirror'), 60_000).then(() => true, () => false);
  if (!back) failures.push(`reload-${label}: the editor did not come back within 60 s, so "${line}" could not be checked`);
  else if (!(await editorHas(line))) failures.push(`reload-${label}: "${line}", typed just before the reload, was missing after it`);
}

const dialogOpen = () => !!document.querySelector('[role="dialog"]');
const dialogClosed = () => !document.querySelector('[role="dialog"]');

// WebdriverIO has no command for Appium's legacy /keys route, the one that types
// through the iOS keyboard into whatever has focus (XCUITest's /wda/keys).
async function typeOnKeyboard(text: string) {
  const res = await fetch(`http://127.0.0.1:4723/session/${browser.sessionId}/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: [...text] }),
  });
  if (!res.ok) throw new Error(`typing on the keyboard failed: ${res.status} ${await res.text()}`);
}

/**
 * A real touch drag on the nth `selector` match, from and to offsets (px) from its centre,
 * holding `hold` ms before lifting. Records what the note list did and checks it (#778).
 */
async function gesture(name: Gesture, selector: string, index: number, from: [number, number], to: [number, number], hold = 0) {
  const el = (await browser.$$(selector))[index];
  await browser.execute(startGestureProbe);
  await browser
    .action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ origin: el, x: from[0], y: from[1] })
    .down()
    .pause(100)
    .move({ origin: el, x: to[0], y: to[1], duration: 400 })
    .pause(hold)
    .up()
    .perform();
  // Lets the snap and the pull's spring finish before the probe stops.
  await browser.pause(800);
  const probe = (await browser.execute(stopGestureProbe)) as GestureProbe;
  const problems = gestureProblems(name, probe);
  const file = await screenshot(`gesture-${name}`);
  failures.push(...problems.map((p) => `gesture-${name}: ${p}`));
  summary.push(`| gesture-${name} | ${file} | ${problems.join('<br>') || 'none'} (${JSON.stringify(probe)}) |`);
  console.log(`${problems.length ? '✗' : '✓'} gesture-${name} ${JSON.stringify(probe)}${problems.map((p) => `\n    ${p}`).join('')}`);
}

/** A real one-finger drag on the first `selector` match, `dy` px down (negative: up) from its centre. */
async function touchDrag(selector: string, dy: number) {
  const [el] = await browser.$$(selector);
  await browser
    .action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ origin: el, x: 0, y: 0 })
    .down()
    .pause(100)
    .move({ origin: el, x: 0, y: dy, duration: 500 })
    .up()
    .perform();
  // Lets the sheet's spring or exit and any momentum scroll finish.
  await browser.pause(800);
}

async function closeDialog() {
  await tap('[role="dialog"] [data-slot="dialog-close"]');
  await waitFor('the dialog to close', dialogClosed);
}

/** After a tap into a field: the page must not have zoomed, and pinch zoom must stay allowed (#785). */
async function checkZoom(field: string) {
  // Safari's focus zoom animates for about 300 ms.
  await browser.pause(1_000);
  // Strings: an object property read straight from visualViewport came back undefined from Safari.
  const [rawScale, viewport] = await browser.execute(() => [
    String(window.visualViewport ? window.visualViewport.scale : 'none'),
    document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  ]);
  const scale = parseFloat(rawScale);
  const problems = zoomProblems(field, scale, viewport);
  failures.push(...problems.map((p) => `zoom: ${p}`));
  summary.push(`| zoom: ${field} | | scale ${scale}${problems.length ? `<br>${problems.join('<br>')}` : ''} |`);
  console.log(`${problems.length ? '✗' : '✓'} zoom: ${field} (scale ${scale})${problems.map((p) => `\n    ${p}`).join('')}`);
}

try {
  // Sign in with the hermetic fake identity, as the Playwright `app` fixture does.
  const auth = JSON.parse(readFileSync('e2e/fixtures/hermetic-auth.json', 'utf8')) as {
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
  };
  await browser.url(`${BASE}/welcome`);
  assertTestOrigin(await browser.execute(() => location.origin));
  await tap('#identity');
  await checkZoom('the sign-in field');
  await browser.execute((items) => {
    for (const { name, value } of items) localStorage.setItem(name, value);
  }, auth.origins.find((o) => o.origin === BASE)!.localStorage);
  await boot();

  // At the root a phone shows the sidebar.
  const portrait = await check('sidebar');
  // The tab bar (#853) must be on screen; layoutProblems checks it clears the home indicator.
  if (!portrait.tabBar) failures.push('tab bar: no tab bar on the phone home screen');

  await browser.setOrientation('LANDSCAPE');
  await waitFor('landscape', () => innerWidth > innerHeight);
  const landscape = await check('sidebar-landscape');
  await browser.setOrientation('PORTRAIT');
  await waitFor('portrait', () => innerWidth < innerHeight);
  const safeArea = safeAreaProblem([portrait.insets, landscape.insets]);
  if (safeArea) failures.push(`safe area: ${safeArea}`);
  summary.push(`| safe area | | portrait ${JSON.stringify(portrait.insets)}, landscape ${JSON.stringify(landscape.insets)}${safeArea ? `<br>${safeArea}` : ''} |`);

  // Folder options. A user long-presses the folder; the menu is opened with the
  // contextmenu event Radix also listens to, since only its layout is checked here.
  await browser.execute(() => {
    const folder = document.querySelector('[aria-label="Folders"] button')!;
    const r = folder.getBoundingClientRect();
    folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 12, clientY: r.top + r.height / 2 }));
  });
  await waitFor('the folder options', () => !!document.querySelector('[role="menu"]'));
  await check('folder-options');
  await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await waitFor('the folder options to close', () => !document.querySelector('[role="menu"]'));

  // A real long press on a sidebar row (#856): chrome has -webkit-touch-callout: none, so iOS shows no
  // link preview or callout; the app's own folder menu may open, and is closed again.
  const rowCallout = await browser.execute(() => getComputedStyle(document.querySelector('[aria-label="Folders"] button')!).getPropertyValue('-webkit-touch-callout'));
  if (rowCallout !== 'none') failures.push(`native-feel: a sidebar row has -webkit-touch-callout ${rowCallout || 'unset'}, not none`);
  const [folderRow] = await browser.$$('[aria-label="Folders"] button');
  await browser.action('pointer', { parameters: { pointerType: 'touch' } }).move({ origin: folderRow, x: 0, y: 0 }).down().pause(900).up().perform();
  await browser.pause(500);
  summary.push(`| native-feel: long press on a sidebar row | ${await screenshot('long-press-sidebar-row')} | -webkit-touch-callout ${rowCallout} |`);
  await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await waitFor('the folder options to close', () => !document.querySelector('[role="menu"]'));

  await tap('[aria-label="Folders"] button');
  await browser.$('button[aria-label="Back to notes"]').waitForDisplayed({ timeout: 30_000 });
  await check('note-list');

  // On a phone, New note is the floating button (#878).
  await tap('button[aria-label="New note"]');
  await browser.$('.ProseMirror').waitForDisplayed({ timeout: 30_000 }).catch(async (error: Error) => {
    // The editor can fall back to "The editor failed to load." (#862): keep why, in the artifacts.
    const shown = (await browser.execute(() => document.body.innerText.slice(0, 500)).catch(() => '')) as string;
    const logs = await safariConsole().catch((e: Error) => [`(no console: ${e.message})`]);
    writeFileSync(`${OUT}/editor-missing-console.log`, [`page text: ${shown}`, ...logs].join('\n'));
    await screenshot('editor-missing').catch(() => {});
    throw new Error(`${error.message}; page text: ${shown.replace(/\s+/g, ' ')}`);
  });
  await check('note');

  // Tap into the editor, then type through the software keyboard itself.
  await tap('.ProseMirror');
  const keyboardUp = await browser.isKeyboardShown();
  if (keyboardUp) {
    await typeOnKeyboard(TYPED.join('\n'));
    await waitFor('the typed lines', () => document.querySelector('.ProseMirror')?.textContent?.includes('Third line') ?? false);
    // MobileToolbar shows once the visual viewport shrinks for the keyboard; a
    // timeout here is reported by the check below, so it doesn't throw.
    await waitFor('the visual viewport to shrink', () => (visualViewport?.height ?? innerHeight) < innerHeight - 150, 10_000).catch(() => {});
  } else {
    warnings.push('The software keyboard did not show after tapping the editor, so the keyboard checks did not run (STOP condition in #799).');
  }
  await check('editor-keyboard', keyboardUp);

  // The link sheet (#827) from the keyboard toolbar: type a URL into it with real touches and the
  // software keyboard, Done inserts the link and gives focus back to the editor.
  if (keyboardUp) {
    await tap('[data-mobile-toolbar] [title="Add Link"]');
    await waitFor('the link sheet', () => !!document.querySelector('[role="dialog"] #editor-link-url'));
    await browser.pause(500); // its 300 ms slide in
    const keyboardOnOpen = await browser.isKeyboardShown();
    await tap('#editor-link-url');
    await waitFor('the visual viewport to shrink', () => (visualViewport?.height ?? innerHeight) < innerHeight - 150, 10_000).catch(() => {});
    const keyboardInSheet = await browser.isKeyboardShown();
    await browser.pause(1_000); // the keyboard's slide and Safari's scroll to the field
    await check('link-sheet-keyboard');
    await checkZoom('the link URL field');
    await typeOnKeyboard('example.com');
    const typed = (await browser.execute(() => document.querySelector<HTMLInputElement>('#editor-link-url')?.value ?? '')) as string;
    await tap('[role="dialog"] button[type="submit"]');
    await waitFor('the link sheet to close', dialogClosed, 10_000);
    await browser.pause(800); // the exit and the focus return
    const after = await browser.execute(() => ({
      link: document.querySelector('.ProseMirror a[href="https://example.com"]')?.textContent ?? '',
      focused: !!document.activeElement?.closest('.ProseMirror'),
    }));
    const keyboardAfter = await browser.isKeyboardShown();
    const problems = [
      ...(typed === 'example.com' ? [] : [`the URL field held "${typed}" after typing "example.com"`]),
      ...(after.link ? [] : ['Done did not insert the link']),
      ...(after.focused ? [] : ['the editor did not get focus back']),
    ];
    failures.push(...problems.map((p) => `link-sheet: ${p}`));
    const keyboards = `keyboard: on open ${keyboardOnOpen}, in the URL field ${keyboardInSheet}, after Done ${keyboardAfter}`;
    summary.push(`| link-sheet | ${await screenshot('link-sheet-done')} | ${problems.join('<br>') || 'none'} (${keyboards}) |`);
    console.log(`${problems.length ? '✗' : '✓'} link-sheet (${keyboards})${problems.map((p) => `\n    ${p}`).join('')}`);
  }

  // A long press on a word in the note selects it (#856): body is user-select: none, and the editor
  // must still allow selection and keep the caret inside it.
  if (keyboardUp) {
    // An element origin: a 'viewport' origin is in screen points, above the page by the status bar.
    const [index, half] = await browser.execute(() => {
      const ps = [...document.querySelectorAll('.ProseMirror p')];
      const i = ps.findIndex((el) => el.textContent?.includes('First line'));
      ps[i].scrollIntoView({ block: 'center' });
      return [i, Math.round(ps[i].getBoundingClientRect().width / 2)];
    });
    const word = (await browser.$$('.ProseMirror p'))[index];
    // 20 px into the paragraph: inside "First".
    await browser.action('pointer', { parameters: { pointerType: 'touch' } }).move({ origin: word, x: 20 - half, y: 0 }).down().pause(1_200).up().perform();
    await browser.pause(800);
    const selected = await browser.execute(() => {
      const sel = getSelection();
      const editor = document.querySelector('.ProseMirror');
      return {
        text: sel?.toString() ?? '',
        inEditor: !!sel?.anchorNode && !!editor?.contains(sel.anchorNode) && !!sel.focusNode && editor.contains(sel.focusNode),
      };
    });
    if (!selected.text.trim()) failures.push('native-feel: a long press on a word in the editor selected no text');
    if (!selected.inEditor) failures.push('native-feel: after a long press in the editor, the selection is not inside the editor');
    summary.push(`| native-feel: long press on a word in the editor | ${await screenshot('editor-long-press-select')} | selected "${selected.text}", in editor ${selected.inEditor} |`);
    console.log(`${selected.text.trim() && selected.inEditor ? '✓' : '✗'} native-feel: editor long press selected "${selected.text}" (in editor ${selected.inEditor})`);
    await browser.execute(() => getSelection()?.collapseToEnd());
  }

  // In-app Back pops the note's entry instead of pushing the list (#822).
  const noteIdx = await browser.execute(() => (history.state as { idx?: number } | null)?.idx ?? 0);
  await tap(noteBack);
  await waitFor('the note list', () => location.pathname.split('/').filter(Boolean).length === 1);
  const listIdx = await browser.execute(() => (history.state as { idx?: number } | null)?.idx ?? 0);
  if (listIdx !== noteIdx - 1) failures.push(`in-app Back: history idx went ${noteIdx} -> ${listIdx}, expected ${noteIdx - 1} (a pop)`);
  summary.push(`| in-app Back | | history idx ${noteIdx} -> ${listIdx} |`);
  await check('back-to-list');
  // Forward to the note again (a popstate) for the reload checks below.
  await browser.execute(() => history.forward());
  await waitFor('the note again', () => !!document.querySelector('.ProseMirror'));

  // Reload right after typing, where a reload once hung on the splash (#806), then again as
  // soon as each boot reaches the editor (#901). Repeated, as one reload may not be enough to
  // hit the hang; a boot over 8 s fails.
  for (let i = 1; i <= 5; i++) await reloadCheck('location.reload', `quick-reload-${i}`, 8_000);
  await reloadCheck('webdriver-refresh');
  if (keyboardUp && !(await editorHas('Third line'))) failures.push('The lines typed before the reloads were not in the note after them.');
  // Reloads while the edit is still being saved (#873), repeated, as the loss did not
  // happen on every run.
  for (let i = 1; i <= 5; i++) await typeAndReload(`In flight ${i}`, 'location.reload', `during-write-${i}`);

  // Load the root right after typing: the step that first hung on the splash (first run
  // of #803; Safari's back/forward cache kept the old page's database worker). After a
  // reload, history.back() loads a new document for each entry, so it is not used here.
  await typeAndReload('Before the root', 'load-root', 'load-root');
  // The root opens the last note on a phone: back to the sidebar with the app's own back buttons.
  await tap(noteBack);
  await tap('[aria-label="Back to notes"]');
  await waitFor('the sidebar', () => {
    const r = document.querySelector('[aria-label="Sidebar"]')?.getBoundingClientRect();
    return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1;
  });
  await tap('button=Settings');
  await waitFor('Settings', dialogOpen);
  const tabs = await browser.execute(() => [...document.querySelectorAll('[role="dialog"] [role="tab"]')].map((t) => t.textContent?.trim() ?? ''));
  for (const [i, tab] of tabs.entries()) {
    await tap('[role="dialog"] [role="tab"]', i);
    await browser.waitUntil(
      () => browser.execute((n) => document.querySelectorAll('[role="dialog"] [role="tab"]')[n]?.getAttribute('aria-selected') === 'true', i),
      { timeout: 30_000, timeoutMsg: `timed out waiting for the ${tab} tab` },
    );
    await check(`settings-${tab.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  await closeDialog();

  // The system Back, which iOS swipe-back fires, closes a dialog and keeps the screen under it (#822).
  await tap('button=Settings');
  await waitFor('Settings', dialogOpen);
  // The dialog pushes its history entry in an effect after it paints; a Back before that pops the screen's entry.
  await waitFor('the Settings history entry', () => ((history.state as { usr?: { overlays?: string[] } } | null)?.usr?.overlays?.length ?? 0) > 0);
  const under = await browser.execute(() => location.href);
  await browser.execute(() => history.back());
  await waitFor('Settings to close on Back', dialogClosed);
  const after = await browser.execute(() => location.href);
  if (after !== under) failures.push(`system Back on Settings: the URL changed from ${under} to ${after}`);
  summary.push(`| system Back on Settings | | ${after === under ? 'closed, same URL' : `URL ${under} -> ${after}`} |`);
  await check('settings-system-back');

  // A dialog with a text field: tapping the field must not zoom the page.
  await tap('[aria-label="New folder"]');
  await waitFor('the New folder dialog', dialogOpen);
  await tap('[placeholder="Folder Name"]');
  // The dialog buttons must clear the keyboard (#783); a timeout leaves the check to report it.
  await waitFor('the visual viewport to shrink', () => (visualViewport?.height ?? innerHeight) < innerHeight - 150, 10_000).catch(() => {});
  await check('new-folder-dialog');
  await checkZoom('the New folder field');
  await closeDialog();

  // Search on a phone is a full-screen sheet that ends above the keyboard (#780).
  await tap('button=Search');
  await waitFor('the search sheet', () => !!document.querySelector('[role="dialog"][aria-label="Search notes"]'));
  await tap('[placeholder="Search notes..."]');
  await waitFor('the visual viewport to shrink', () => (visualViewport?.height ?? innerHeight) < innerHeight - 150, 10_000).catch(() => {});
  await check('search-sheet-keyboard');
  await tap('button=Cancel');
  await waitFor('the search sheet to close', () => !document.querySelector('[role="dialog"][aria-label="Search notes"]'));

  // Push and pop slides (#779), slowed to 3 s so each screenshot lands mid-slide:
  // folder -> list -> note -> in-app Back. The system Back (what swipe-back fires)
  // must start no slide of ours, since Safari animates the swipe itself.
  if (await browser.execute(() => typeof document.startViewTransition !== 'function')) {
    warnings.push('This Safari has no View Transitions, so the slide step did not run and the app navigates without a slide.');
  } else {
    await browser.execute(() => {
      const style = document.createElement('style');
      style.id = 'slow-slide';
      style.textContent = '::view-transition-old(root), ::view-transition-new(root) { animation-duration: 3s !important; }';
      document.head.appendChild(style);
      const w = window as unknown as { slides: string[] };
      w.slides = [];
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = ((update: () => Promise<void>) => {
        w.slides.push(document.documentElement.dataset.nav ?? 'forward');
        return start(update);
      }) as typeof document.startViewTransition;
    });
    const midSlide = async (name: string) => {
      await browser.pause(700);
      summary.push(`| ${name} | ${await screenshot(name)} | mid-slide |`);
      await browser.pause(3_000);
    };
    await tap('[aria-label="Folders"] button');
    await midSlide('slide-folder-to-list');
    await tap('button[aria-label="New note"]');
    await midSlide('slide-list-to-note');
    await tap(noteBack);
    await midSlide('slide-back-to-list');
    await browser.execute(() => history.back());
    await waitFor('the sidebar', () => {
      const r = document.querySelector('[aria-label="Sidebar"]')?.getBoundingClientRect();
      return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1;
    });
    await browser.pause(700);
    summary.push(`| system-back-no-slide | ${await screenshot('system-back-no-slide')} | |`);
    const slides = await browser.execute(() => {
      document.getElementById('slow-slide')?.remove();
      return (window as unknown as { slides: string[] }).slides;
    });
    const expected = ['forward', 'forward', 'back'];
    if (JSON.stringify(slides) !== JSON.stringify(expected)) {
      failures.push(`slides: started ${JSON.stringify(slides)}, expected ${JSON.stringify(expected)} (none on the system Back)`);
    }
    summary.push(`| slides | | ${JSON.stringify(slides)} |`);
  }

  // Note list gestures (#778): import enough notes for the list to scroll, then swipe a
  // row, scroll with sideways drift, pull to refresh at the top and scroll again.
  await tap('button=Settings');
  await waitFor('Settings', dialogOpen);
  await tap('[role="dialog"] [role="tab"]', tabs.findIndex((t) => t.includes('Data')));
  await waitFor('the import field', () => !!document.querySelector('[role="dialog"] input[type="file"]'));
  assertTestOrigin(await browser.execute(() => location.origin));
  await browser.execute((count) => {
    const files = new DataTransfer();
    for (let i = 1; i <= count; i++) {
      files.items.add(new File([`---\ntitle: Gesture note ${i}\n---\nBody ${i}\n`], `gesture-${i}.md`, { type: 'text/markdown' }));
    }
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!;
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, 20);
  await waitFor('the import', () => document.body.textContent?.includes('Successfully imported 20 notes') ?? false, 60_000);
  await closeDialog();
  await tap('[aria-label="Folders"] button');
  await waitFor('the note rows', () => document.querySelectorAll('[data-testid="note-row"]').length >= 10);
  // Touches during the push slide (#779) land on its overlay, not the list.
  await browser.pause(600);
  const row = '[data-testid="note-row"]';
  await gesture('swipe', row, 0, [100, 0], [0, 6]);
  await tap('[aria-label="Sort notes"]');
  await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  // Drags stay on the list: one that starts on Safari's bottom toolbar opens its tab overview.
  await gesture('drift-scroll', row, 3, [60, 0], [20, -260]);
  await browser.execute((sel) => document.querySelector(sel)!.closest('[data-radix-scroll-area-viewport]')!.scrollTo(0, 0), row);
  await gesture('pull', row, 0, [0, 0], [0, 150], 600);
  await waitFor('the refresh to finish', () => !document.querySelector('[data-pull-to-refresh] .animate-spin'), 15_000).catch(() => {});
  await gesture('scroll-after-pull', row, 3, [0, 0], [0, -260]);

  // Native feel (#856): the page never bounces, a long press on chrome shows no callout, a double tap does not zoom.
  const touchAt = async (selector: string, steps: (a: ReturnType<typeof browser.action>, el: WebdriverIO.Element) => ReturnType<typeof browser.action>) => {
    const el = (await browser.$$(selector))[0];
    // The earlier scroll gestures leave the list scrolled: bring the target back (the first row puts the list at its top).
    await browser.execute((e) => e.scrollIntoView({ block: 'center' }), el);
    await steps(browser.action('pointer', { parameters: { pointerType: 'touch' } }), el).perform();
  };
  await touchAt(row, (a, el) =>
    a.move({ origin: el, x: 0, y: 0 }).down().pause(100).move({ origin: el, x: 0, y: 200, duration: 400 }).up(),
  );
  await browser.pause(800);
  const scrollY = await browser.execute(() => window.scrollY);
  if (scrollY !== 0) failures.push(`native-feel: the page scrolled to ${scrollY} on a pull down at the top of the list`);
  summary.push(`| native-feel: no page bounce | | window.scrollY ${scrollY} |`);
  await touchAt(row, (a, el) => a.move({ origin: el, x: 0, y: 0 }).down().pause(900).up());
  summary.push(`| native-feel: long press on a row | ${await screenshot('long-press-row')} | no system callout |`);
  // The long press opens the row's menu, a modal that would swallow the next touches: close it.
  await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await browser.pause(300);
  await touchAt('[aria-label="Sort notes"]', (a, el) =>
    a.move({ origin: el, x: 0, y: 0 }).down().up().pause(80).down().up(),
  );
  await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await checkZoom('a double tap on a button');

  // The sheet primitive (#823) in real Safari: a drag down on its grabber closes it, a drag on its
  // body scrolls the body and leaves it open, and with its field focused it sits above the keyboard.
  // It runs after the gestures above: Appium calibrates its first touch action with an overlay tap,
  // which an open modal (body pointer-events: none) would swallow.
  const sheetShown = () => !!document.querySelector('[data-slot="sheet-content"]');
  const openSheet = async () => {
    assertTestOrigin(await browser.execute(() => location.origin));
    await browser.execute(() => void window.__journalE2E!.showSheet());
    await waitFor('the sheet', sheetShown);
    await browser.pause(500); // its 300 ms slide in
  };
  await openSheet();
  await check('sheet');
  await touchDrag('[data-slot="sheet-grabber"]', 400);
  const dragClosed = await waitFor('the sheet to close', () => !document.querySelector('[data-slot="sheet-content"]'), 5_000).then(() => true, () => false);
  if (!dragClosed) failures.push('sheet: a long drag down on the grabber did not close it');
  summary.push(`| sheet-drag-to-close | ${await screenshot('sheet-drag-to-close')} | ${dragClosed ? 'closed' : 'still open'} |`);

  await openSheet();
  const bodyScroll = () => document.querySelector('[data-slot="sheet-body"]')?.scrollTop ?? -1;
  await touchDrag('[data-slot="sheet-body"]', -250);
  const scrolledDown = (await browser.execute(bodyScroll)) as number;
  const openAfterUp = (await browser.execute(sheetShown)) as boolean;
  await touchDrag('[data-slot="sheet-body"]', 250);
  const scrolledBack = (await browser.execute(bodyScroll)) as number;
  const openAfterDown = (await browser.execute(sheetShown)) as boolean;
  const scrollProblems = [
    ...(scrolledDown > 50 ? [] : [`a drag up on the body did not scroll it (scrollTop ${scrolledDown})`]),
    ...(openAfterUp && openAfterDown ? [] : ['a drag on the body closed the sheet']),
    ...(scrolledBack < scrolledDown ? [] : [`a drag down on the body did not scroll it back (scrollTop ${scrolledDown} -> ${scrolledBack})`]),
  ];
  failures.push(...scrollProblems.map((p) => `sheet-scroll: ${p}`));
  summary.push(`| sheet-scroll | ${await screenshot('sheet-scroll')} | ${scrollProblems.join('<br>') || `none (scrollTop ${scrolledDown} -> ${scrolledBack})`} |`);

  await tap('[data-slot="sheet-content"] input');
  await waitFor('the visual viewport to shrink', () => (visualViewport?.height ?? innerHeight) < innerHeight - 150, 10_000).catch(() => {});
  if (await browser.isKeyboardShown()) {
    await browser.pause(1_000); // the keyboard's slide and Safari's scroll to the field
    const vars = await browser.execute(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
      const vv = visualViewport!;
      return `--sheet-bottom ${el?.style.getPropertyValue('--sheet-bottom') || 'unset'}, --sheet-h ${el?.style.getPropertyValue('--sheet-h') || 'unset'}; viewport ${Math.round(vv.offsetTop)}+${Math.round(vv.height)} of ${innerHeight}, scale ${vv.scale}`;
    });
    summary.push(`| sheet-keyboard vars | | ${vars} |`);
    console.log(`  sheet-keyboard: ${vars}`);
    await check('sheet-keyboard');
  }
  else warnings.push('The software keyboard did not show after tapping the sheet field, so the sheet keyboard check did not run.');
  await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await waitFor('the sheet to close', () => !document.querySelector('[data-slot="sheet-content"]'));

  // The image viewer (#829) in real Safari: a tap selects the image, a tap on the selected image
  // opens the full-screen viewer, and a real swipe down on the image closes it.
  await tap('button[aria-label="New note"]');
  await browser.$('.ProseMirror').waitForDisplayed({ timeout: 30_000 });
  assertTestOrigin(await browser.execute(() => location.origin));
  // A same-origin image, pasted as HTML so it skips the upload pipeline (as viewer.mobile.spec.ts does).
  await browser.execute(() => {
    const el = document.querySelector<HTMLElement>('.ProseMirror')!;
    el.focus();
    const data = new DataTransfer();
    data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await waitFor('the pasted image', () => !!document.querySelector<HTMLImageElement>('.ProseMirror img[alt="Journal logo"]')?.complete);
  const viewerShown = () => !!document.querySelector('[role="dialog"] [data-testid="lightbox-zoom"]');
  const imageSelected = () => !!document.querySelector('.ProseMirror-selectednode img[alt="Journal logo"]');
  const image = '.ProseMirror img[alt="Journal logo"]';
  await tap(image);
  await browser.pause(600);
  const selectedAfterFirst = (await browser.execute(imageSelected)) as boolean;
  // The tap brings up the keyboard, which shifts Safari's visual viewport under Appium's tap
  // mapping; a finger has no such problem. Put it away (the image stays selected) before tapping again.
  if (await browser.isKeyboardShown()) {
    await browser.hideKeyboard().catch(() => {});
    await waitFor('the keyboard to go', () => (visualViewport?.height ?? innerHeight) >= innerHeight - 5, 5_000).catch(() => {});
  }
  const firstTapShot = await screenshot('image-first-tap');
  // What the second tap fires, to explain a viewer that does not open.
  await browser.execute(() => {
    const log: string[] = ((window as unknown as { __tapLog: string[] }).__tapLog = []);
    for (const t of ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'click', 'dblclick'])
      document.addEventListener(t, (e) => log.push(`${t}:${(e.target as Element).tagName}.${String((e.target as Element).className).slice(0, 40)}:${(e as PointerEvent).pointerType ?? ''}`), true);
  });
  await tap(image);
  const viewerOpened = await waitFor('the image viewer', viewerShown, 5_000).then(() => true, () => false);
  summary.push(`| image-tap-to-open | ${firstTapShot} | first tap selected the image: ${selectedAfterFirst}; second tap opened the viewer: ${viewerOpened} |`);
  if (!selectedAfterFirst) failures.push('image-viewer: the first tap did not select the image');
  if (!viewerOpened) {
    const events = (await browser.execute(() => (window as unknown as { __tapLog: string[] }).__tapLog.join(' '))) as string;
    failures.push(`image-viewer: a tap on the selected image did not open the viewer (events: ${events})`);
    await screenshot('image-second-tap');
  } else {
    await browser.pause(500); // its 200 ms fade in
    const layout = await check('image-viewer');
    const closeTop = (await browser.execute(() => document.querySelector('[role="dialog"] [aria-label="Close"]')!.getBoundingClientRect().top)) as number;
    if (closeTop < layout.insets.top) failures.push(`image-viewer: Close (top ${Math.round(closeTop)}) is under the status bar (inset ${layout.insets.top})`);
    await touchDrag('[role="dialog"] [data-testid="lightbox-zoom"]', 300);
    const swipeClosed = await waitFor('the viewer to close', () => !document.querySelector('[role="dialog"] [data-testid="lightbox-zoom"]'), 5_000).then(() => true, () => false);
    if (!swipeClosed) failures.push('image-viewer: a swipe down on the image did not close the viewer');
    summary.push(`| image-viewer-swipe-to-close | ${await screenshot('image-viewer-swipe-to-close')} | ${swipeClosed ? 'closed' : 'still open'}; Close top ${Math.round(closeTop)}, inset ${layout.insets.top} |`);
    console.log(`${swipeClosed ? '✓' : '✗'} image-viewer: swipe down ${swipeClosed ? 'closed' : 'did not close'} the viewer`);
  }
} catch (error) {
  failures.push(`run: ${(error as Error).message}`);
  await screenshot('error').catch(() => {});
} finally {
  await browser.deleteSession().catch(() => {});
}

for (const w of warnings) console.log(`::warning::${w}`);
for (const f of failures) console.log(`::error::${f}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const status = failures.length ? `${failures.length} problem(s)` : 'no problems';
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [`## iOS Safari: ${status}`, '', ...warnings.map((w) => `> [!WARNING]\n> ${w}\n`), ...summary, '', ...failures.map((f) => `- ${f}`), ''].join('\n'),
  );
}
process.exit(failures.length ? 1 : 0);
