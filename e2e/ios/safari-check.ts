// Real iOS Safari check (#799): drives the e2e build in Mobile Safari on an iOS
// Simulator through Appium's XCUITest driver, screenshots each flow and fails
// on the layout problems in ./checks.ts. CI only (.github/workflows/ios-safari.yml);
// see "iOS Safari" in e2e/README.md. Run with Node 22.18+ (it strips the types).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { remote } from 'webdriverio';
import { layoutProblems, measureLayout, safeAreaProblem, type Layout } from './checks.ts';

const BASE = 'http://127.0.0.1:4173';
const OUT = 'test-results/ios-safari';
const TYPED = ['First line', 'Second line', 'Third line'];

const failures: string[] = [];
const warnings: string[] = [];
const summary: string[] = ['| Step | Screenshot | Problems |', '|---|---|---|'];
let shots = 0;

mkdirSync(OUT, { recursive: true });

const browser = await remote({
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  logLevel: 'warn',
  // The first session builds WebDriverAgent, which takes minutes.
  connectionRetryTimeout: 600_000,
  connectionRetryCount: 0,
  capabilities: {
    platformName: 'iOS',
    browserName: 'Safari',
    'appium:automationName': 'XCUITest',
    'appium:udid': process.env.IOS_UDID,
    // Taps are real touches at the element's position, not script clicks: only a
    // real tap brings up the software keyboard.
    'appium:nativeWebTap': true,
    'appium:forceSimulatorSoftwareKeyboardPresence': true,
    'appium:wdaLaunchTimeout': 600_000,
    'appium:wdaConnectionTimeout': 600_000,
    'appium:newCommandTimeout': 300,
  },
});

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

async function closeDialog() {
  await tap('[role="dialog"] [data-slot="dialog-close"]');
  await waitFor('the dialog to close', dialogClosed);
}

try {
  // Sign in with the hermetic fake identity, as the Playwright `app` fixture does.
  const auth = JSON.parse(readFileSync('e2e/fixtures/hermetic-auth.json', 'utf8')) as {
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
  };
  await browser.url(`${BASE}/welcome`);
  assertTestOrigin(await browser.execute(() => location.origin));
  await browser.execute((items) => {
    for (const { name, value } of items) localStorage.setItem(name, value);
  }, auth.origins.find((o) => o.origin === BASE)!.localStorage);
  await boot();

  // At the root a phone shows the sidebar.
  const portrait = await check('sidebar');

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

  await tap('[aria-label="Folders"] button');
  await browser.$('button=New').waitForDisplayed({ timeout: 30_000 });
  await check('note-list');

  await tap('button=New');
  await browser.$('.ProseMirror').waitForDisplayed({ timeout: 30_000 });
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

  // In-app Back pops the note's entry instead of pushing the list (#822).
  const noteIdx = await browser.execute(() => (history.state as { idx?: number } | null)?.idx ?? 0);
  await tap('button[aria-label="Back"]');
  await waitFor('the note list', () => location.pathname.split('/').filter(Boolean).length === 1);
  const listIdx = await browser.execute(() => (history.state as { idx?: number } | null)?.idx ?? 0);
  if (listIdx !== noteIdx - 1) failures.push(`in-app Back: history idx went ${noteIdx} -> ${listIdx}, expected ${noteIdx - 1} (a pop)`);
  summary.push(`| in-app Back | | history idx ${noteIdx} -> ${listIdx} |`);
  await check('back-to-list');

  // Back to the sidebar through in-app history: reloading the page here left
  // Safari on the splash screen for minutes in CI (first run of #803).
  await browser.waitUntil(
    async () => {
      const atRoot = await browser.execute(() => {
        const r = document.querySelector('[aria-label="Sidebar"]')?.getBoundingClientRect();
        return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1;
      });
      if (atRoot) return true;
      await browser.execute(() => history.back());
      return false;
    },
    { timeout: 30_000, interval: 1_000, timeoutMsg: 'timed out going back to the sidebar' },
  );
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
  await closeDialog();

  // Search on a phone is a full-screen sheet that ends above the keyboard (#780).
  await tap('button=Search');
  await waitFor('the search sheet', () => !!document.querySelector('[role="dialog"][aria-label="Search notes"]'));
  await tap('[placeholder="Search notes..."]');
  await waitFor('the visual viewport to shrink', () => (visualViewport?.height ?? innerHeight) < innerHeight - 150, 10_000).catch(() => {});
  await check('search-sheet-keyboard');
  await tap('button=Cancel');
  await waitFor('the search sheet to close', () => !document.querySelector('[role="dialog"][aria-label="Search notes"]'));
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
