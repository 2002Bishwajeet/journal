import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, activeTitleInput, inBothThemes, openNote, selectFolder } from '../support/actions';

// WebMCP (#705): where the browser has it, the user can let its agent use Journal. A fake
// `document.modelContext` records what the app registers, so the spec calls the tools the way
// the browser's agent would. What the agent sees follows Settings -> Agent access.

const SECRET = 'SECRET-TEXT-42';

interface FakeWebMcp {
  names(): string[];
  registrations(): number;
  call(name: string, args: unknown): Promise<string>;
  pending: Promise<string> | null;
}
const webmcp = (page: Page) => ({
  names: () => page.evaluate(() => (window as unknown as { __webmcp: FakeWebMcp }).__webmcp.names()),
  registrations: () => page.evaluate(() => (window as unknown as { __webmcp: FakeWebMcp }).__webmcp.registrations()),
  call: (name: string, args: unknown) =>
    page.evaluate(([n, a]) => (window as unknown as { __webmcp: FakeWebMcp }).__webmcp.call(n as string, a), [name, args] as const),
  /** Calls a tool without waiting for it to settle. */
  start: (name: string, args: unknown) =>
    page.evaluate(([n, a]) => {
      const fake = (window as unknown as { __webmcp: FakeWebMcp }).__webmcp;
      fake.pending = fake.call(n as string, a);
    }, [name, args] as const),
  settled: () => page.evaluate(() => (window as unknown as { __webmcp: FakeWebMcp }).__webmcp.pending),
});

function installFakeModelContext() {
  type Tool = { name: string; execute(args: unknown, options?: { signal?: AbortSignal }): Promise<string> };
  const live = new Map<string, Tool>();
  let registrations = 0;
  (document as unknown as { modelContext: unknown }).modelContext = {
    registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
      live.set(tool.name, tool);
      registrations++;
      options?.signal?.addEventListener('abort', () => {
        if (live.get(tool.name) === tool) live.delete(tool.name);
      });
      return Promise.resolve();
    },
  };
  (window as unknown as { __webmcp: FakeWebMcp }).__webmcp = {
    names: () => [...live.keys()],
    registrations: () => registrations,
    call: (name, args) => live.get(name)!.execute(args, {}),
    pending: null,
  };
}

async function importNotes(page: Page, notes: Record<string, string>) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles(
    Object.entries(notes).map(([name, text]) => ({ name: `${name}.md`, mimeType: 'text/markdown', buffer: Buffer.from(text) })),
  );
  await expect(page.getByText(`Successfully imported ${Object.keys(notes).length} notes`)).toBeVisible();
  await page.keyboard.press('Escape');
}

async function openNoteId(page: Page, title: string): Promise<string> {
  await openNote(page, title);
  await expect(activeTitleInput(page)).toHaveValue(title);
  return new URL(page.url()).pathname.split('/').pop()!;
}

async function openAgentAccess(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Agent access' }).click();
  return dialog;
}

const NOTE_TOOLS = ['list_folders', 'list_notes', 'search_notes', 'get_note'];
const OPEN_NOTE_TOOLS = ['read_open_note', 'insert_paragraph', 'set_block_type', 'replace_text', 'format_text'];

test('the switch shows only where WebMCP exists, and the browser agent sees only granted notes', async ({ app }) => {
  test.setTimeout(90_000);
  await app.setViewportSize({ width: 1280, height: 900 });
  await assertTestOrigin(app);

  // Canned drive answers: no grants file yet, and a save that never returns, so each
  // choice stays as the optimistic update the app reads grants from.
  await app.route('**/drive/query/specialized/cuid/header**', (route) => {
    const origin = route.request().headers()['origin'] ?? '*';
    return route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 404,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
      },
    });
  });
  await app.route('**/drive/files/upload**', () => {});

  await importNotes(app, {
    'Packing list': '---\ntitle: Packing list\n---\nI packed a passport, a charger and hiking boots for the trip.',
    'Meeting notes': '---\ntitle: Meeting notes\n---\nAgenda for Monday.',
    'Secret plan': `---\ntitle: Secret plan\nexcludeFromAI: true\n---\n${SECRET} is the plan.`,
  });
  await selectFolder(app, 'Main');
  const packingId = await openNoteId(app, 'Packing list');
  const meetingId = await openNoteId(app, 'Meeting notes');
  const secretId = await openNoteId(app, 'Secret plan');

  // Without the API there is no switch.
  let dialog = await openAgentAccess(app);
  await expect(dialog.getByLabel('Agent access for Main')).toBeVisible();
  await expect(dialog.getByRole('switch', { name: /WebMCP/ })).toHaveCount(0);
  await app.keyboard.press('Escape');

  // With it, the switch is there and off, and nothing is registered.
  await app.addInitScript(installFakeModelContext);
  await app.evaluate(installFakeModelContext);
  dialog = await openAgentAccess(app);
  const toggle = dialog.getByRole('switch', { name: /Let this browser's AI agent use Journal/ });
  await expect(toggle).not.toBeChecked();
  expect(await webmcp(app).names()).toEqual([]);

  // Grant Main read, but keep one note back.
  await dialog.getByLabel('Agent access for Main').selectOption('read');
  await dialog.getByRole('button', { name: 'Notes' }).first().click();
  await dialog.getByLabel('Agent access for Meeting notes').selectOption('none');

  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => webmcp(app).names()).toEqual(NOTE_TOOLS);
  await inBothThemes(app, (theme) =>
    dialog
      .locator('div.rounded-xl', { has: app.getByRole('switch', { name: /WebMCP/ }) })
      .screenshot({ path: test.info().outputPath(`webmcp-switch-${theme}-1280.png`), animations: 'disabled' }),
  );
  await app.keyboard.press('Escape');

  // A granted note reads as markdown; an ungranted or excluded one is not found.
  const granted = JSON.parse(await webmcp(app).call('get_note', { id: packingId }));
  expect(granted).toMatchObject({ id: packingId, title: 'Packing list', access: 'read' });
  expect(granted.markdown).toContain('passport');
  await expect(webmcp(app).call('get_note', { id: meetingId })).rejects.toThrow('Note not found');
  await expect(webmcp(app).call('get_note', { id: secretId })).rejects.toThrow('Note not found');
  const listed = JSON.parse(await webmcp(app).call('list_notes', {})) as { title: string }[];
  expect(listed.map((n) => n.title)).toEqual(['Packing list']);
  expect(JSON.stringify(await webmcp(app).call('search_notes', JSON.stringify({ query: SECRET })))).not.toContain(SECRET);
  // The note being read-only for the agent, there are no edit tools yet.
  expect(await webmcp(app).names()).toEqual(NOTE_TOOLS);

  // Read + write on the open note adds the edit tools; an edit waits for Accept in the note.
  await openNoteId(app, 'Packing list');
  dialog = await openAgentAccess(app);
  await dialog.getByLabel('Agent access for Main').selectOption('write');
  await app.keyboard.press('Escape');
  await expect.poll(() => webmcp(app).names()).toEqual([...NOTE_TOOLS, ...OPEN_NOTE_TOOLS]);
  expect(JSON.parse(await webmcp(app).call('read_open_note', {}))).toEqual([
    { n: 1, type: 'paragraph', text: 'I packed a passport, a charger and hiking boots for the trip.' },
  ]);

  const editor = activeEditor(app);
  const bar = editor.getByRole('group', { name: /^Review the assistant's edit/ });
  await webmcp(app).start('format_text', { n: 1, mark: 'bold', on: true });
  await expect(bar).toBeVisible();
  await expect(editor.locator('strong:not(.agent-edit-format)')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Accept' }).click();
  expect(JSON.parse((await webmcp(app).settled())!)).toMatchObject({ outcome: 'accepted', summary: 'Make paragraph 1 bold' });
  await expect(editor.locator('strong')).toHaveText('I packed a passport, a charger and hiking boots for the trip.');

  // Off aborts every registration.
  dialog = await openAgentAccess(app);
  await dialog.getByRole('switch', { name: /Let this browser's AI agent use Journal/ }).click();
  await app.keyboard.press('Escape');
  await expect.poll(() => webmcp(app).names()).toEqual([]);
  expect(await webmcp(app).registrations()).toBe(NOTE_TOOLS.length + OPEN_NOTE_TOOLS.length);
});
