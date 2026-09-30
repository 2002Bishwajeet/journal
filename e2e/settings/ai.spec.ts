import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Settings → AI tells the truth about the model (#212): status only while AI is
// on, a visible error with Retry, a notice on phones, and a ConfirmDialog (no
// page reload) before removing model files.

// Stands in for the WebLLM engine worker (src/lib/webllm/worker.ts), speaking
// the WebWorkerMLCEngine message protocol. A reload reports progress, then waits
// for the test to post 'ok' or 'fail' on the `e2e-webllm` BroadcastChannel;
// every reload's model id is posted on `e2e-webllm-log`.
const FAKE_WORKER = `
const pending = [];
const log = new BroadcastChannel('e2e-webllm-log');
new BroadcastChannel('e2e-webllm').onmessage = ({ data }) => {
  for (const uuid of pending.splice(0)) {
    self.postMessage(data === 'ok'
      ? { kind: 'return', uuid, content: null }
      : { kind: 'throw', uuid, content: 'stub load failure' });
  }
};
self.onmessage = ({ data }) => {
  if (data.kind !== 'reload') {
    self.postMessage({ kind: 'return', uuid: data.uuid, content: null });
    return;
  }
  log.postMessage(data.content.modelId[0]);
  self.postMessage({ kind: 'initProgressCallback', uuid: data.uuid, content: { progress: 0.42, timeElapsed: 0, text: 'Fetching stub model' } });
  pending.push(data.uuid);
};
`;

// Preview build: /assets/worker-<hash>.js (not pglite-worker-*); dev server: the source file.
const isWebLLMWorker = (url: URL) => /\/(assets\/worker-[\w-]+\.js|src\/lib\/webllm\/worker\.ts)$/.test(url.pathname);

async function stubWebLLMWorker(page: Page): Promise<void> {
  // Keep the served headers: under the app's COEP a worker script without one is blocked.
  await page.context().route(isWebLLMWorker, async (route) =>
    route.fulfill({ response: await route.fetch(), body: FAKE_WORKER }),
  );
  await assertTestOrigin(page);
  await page.evaluate(() => {
    const w = window as Window & { __webllmReloads?: string[] };
    w.__webllmReloads = [];
    new BroadcastChannel('e2e-webllm-log').onmessage = ({ data }) => w.__webllmReloads!.push(data);
  });
}

async function finishLoad(page: Page, outcome: 'ok' | 'fail'): Promise<void> {
  await page.evaluate((o) => new BroadcastChannel('e2e-webllm').postMessage(o), outcome);
}

const reloads = (page: Page) =>
  page.evaluate(() => (window as Window & { __webllmReloads?: string[] }).__webllmReloads);

async function openAISettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'AI', exact: true }).click();
  return dialog;
}

test('mobile: explains that AI needs a larger screen and disables the switch', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  const dialog = await openAISettings(app);

  await expect(dialog.getByText("On-device AI needs a larger screen (768 px or wider) and isn't available on phones.")).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Enable on-device AI' })).toBeDisabled();
  await expect(dialog.getByRole('radiogroup', { name: 'Model' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Remove downloaded models' })).toHaveCount(0);
});

test('desktop: status shows loading then ready, and turning AI off hides it', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  const dialog = await openAISettings(app);
  const toggle = dialog.getByRole('switch', { name: 'Enable on-device AI' });
  const status = dialog.getByRole('status');
  const models = dialog.getByRole('radiogroup', { name: 'Model' });

  await expect(toggle).not.toBeChecked();
  await expect(status).toHaveCount(0);
  await expect(models).toHaveCount(0);

  await toggle.click();
  await expect(status).toContainText('Fetching stub model');
  await expect(status).toContainText('42%');
  // Picking another model mid-load would race the load.
  const radios = await models.getByRole('radio').all();
  expect(radios.length).toBeGreaterThan(1);
  for (const radio of radios) await expect(radio).toBeDisabled();

  await finishLoad(app, 'ok');
  await expect(status).toHaveText('Ready · Qwen 2.5 1.5B · running on this device');
  await expect(models.getByRole('radio', { name: /SmolLM2 360M/ })).toBeEnabled();

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(status).toHaveCount(0);
  await expect(models).toHaveCount(0);
  await expect(dialog.getByText(/Model Active/)).toHaveCount(0);
});

test('desktop: a failed load shows the error and Retry loads the model picked since', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  const dialog = await openAISettings(app);
  const status = dialog.getByRole('status');

  await dialog.getByRole('switch', { name: 'Enable on-device AI' }).click();
  await expect(status).toContainText('Fetching stub model');
  await finishLoad(app, 'fail');

  await expect(status).toContainText("Couldn't load the AI model.");
  const retry = status.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await expect(dialog.getByText(/Model Active|Ready ·/)).toHaveCount(0);

  await dialog.locator('label').filter({ hasText: 'SmolLM2 360M' }).click();
  await expect(dialog.getByRole('radio', { name: /SmolLM2 360M/ })).toBeChecked();

  await retry.click();
  await expect(status).toContainText('Fetching stub model');
  await expect.poll(() => reloads(app)).toEqual(['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'SmolLM2-360M-Instruct-q4f16_1-MLC']);
  await finishLoad(app, 'ok');
  await expect(status).toHaveText('Ready · SmolLM2 360M · running on this device');
});

test('desktop: removing model files asks first, turns AI off, and does not reload', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  const dialog = await openAISettings(app);
  const toggle = dialog.getByRole('switch', { name: 'Enable on-device AI' });

  await toggle.click();
  await expect(dialog.getByRole('status')).toContainText('Fetching stub model');
  await finishLoad(app, 'ok');
  await expect(dialog.getByRole('status')).toContainText('Ready ·');

  await assertTestOrigin(app);
  await app.evaluate(() => { (window as Window & { __sameDocument?: boolean }).__sameDocument = true; });

  await dialog.getByRole('button', { name: 'Remove downloaded models' }).click();
  const confirm = app.getByRole('dialog', { name: 'Remove downloaded models?' });
  await expect(confirm).toContainText('AI will be turned off and the model will download again the next time you turn it on.');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect(app.getByText("Model files removed. They'll download again next time AI loads.")).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  expect(await app.evaluate(() => (window as Window & { __sameDocument?: boolean }).__sameDocument)).toBe(true);
});
