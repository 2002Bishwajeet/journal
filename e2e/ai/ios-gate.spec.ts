import { test, expect, waitForAppReady } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, activeTitleInput } from '../support/actions';

// #1143: in the iOS app, AI shows only on a device that passed the check. The native shell is
// faked as in e2e/settings/platforms.spec.ts, with the premium plugin answering device_memory
// with null, as it does in the Simulator. AI is switched on in settings, so a load would start
// if the gate let it: no model request may leave the page, on an iPhone or an iPad screen.

// Model weights (Hugging Face) and web-llm's model libraries (mlc-ai/binary-mlc-llm-libs).
const MODEL_REQUEST = /huggingface\.co|binary-mlc-llm-libs|mlc-ai/;
const CASES = [
  { name: 'iphone', size: { width: 390, height: 844 } },
  { name: 'ipad', size: { width: 820, height: 1180 } },
] as const;

for (const c of CASES) {
  test(`AI is hidden on an iOS device that failed the check (${c.name})`, async ({ app }) => {
    test.setTimeout(90_000);
    await assertTestOrigin(app);
    const modelRequests: string[] = [];
    app.on('request', (r) => {
      if (MODEL_REQUEST.test(r.url())) modelRequests.push(r.url());
    });
    const asked: string[] = [];
    await app.exposeFunction('deviceIpc', (cmd: string) => {
      asked.push(cmd);
      return null;
    });
    await app.addInitScript(() => {
      if (location.hostname !== '127.0.0.1') return;
      const w = window as unknown as Record<string, unknown>;
      w.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['premium'] };
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: (cmd: string) => (w.deviceIpc as (cmd: string) => Promise<unknown>)(cmd),
      };
      localStorage.setItem('journal-ai-settings', JSON.stringify({ _v: 2, enabled: true }));
    });
    await app.setViewportSize(c.size);
    await app.reload();
    await waitForAppReady(app);
    await expect.poll(() => asked).toContain('plugin:premium|device_memory');

    // No AI in Settings. The iPad layout keeps Settings in the folder sidebar.
    const phone = c.size.width < 768;
    if (!phone) await app.getByRole('button', { name: 'Show folders' }).click();
    await app.getByRole('button', { name: 'Settings' }).click();
    const dialog = app.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Appearance', { exact: true }).first()).toBeVisible();
    const aiEntry = phone ? dialog.getByRole('listitem').getByRole('button', { name: 'AI', exact: true }) : dialog.getByRole('tab', { name: 'AI', exact: true });
    await expect(aiEntry).toHaveCount(0);
    for (const scheme of ['light', 'dark'] as const) {
      await app.emulateMedia({ colorScheme: scheme });
      await app.screenshot({ path: test.info().outputPath(`settings-${scheme}-${c.name}.png`), animations: 'disabled' });
    }
    await app.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // No AI commands in the slash menu.
    if (!phone) await app.getByRole('button', { name: 'Close folders' }).click();
    await app.getByRole('button', { name: /^New( note)?$/ }).click();
    await expect(activeTitleInput(app)).toHaveValue('Untitled');
    await activeEditor(app).click();
    await app.keyboard.type('/');
    await expect(app.getByRole('button', { name: /^Heading 1 / })).toBeVisible();
    await expect(app.getByRole('button', { name: /^(Ask AI|Summarize|Rewrite Selection)\b/ })).toHaveCount(0);
    for (const scheme of ['light', 'dark'] as const) {
      await app.emulateMedia({ colorScheme: scheme });
      await app.screenshot({ path: test.info().outputPath(`slash-menu-${scheme}-${c.name}.png`), animations: 'disabled' });
    }

    expect(modelRequests).toEqual([]);
  });
}
