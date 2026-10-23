import type { Page } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';

// The AI requirements check reads navigator.gpu (src/lib/webllm/requirements.ts).
// A real adapter depends on the machine running the spec, so specs stub it:
// a capable adapter (shader-f16, large buffers) or none at all.
function installStub(withAdapter: boolean): void {
  const gpu = withAdapter
    ? {
        requestAdapter: async () => ({
          features: new Set(['shader-f16']),
          limits: { maxBufferSize: 4 * 2 ** 30, maxStorageBufferBindingSize: 2 ** 31 },
        }),
      }
    : undefined;
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });
}

/** Stubs navigator.gpu in the open page and in every page it loads next. */
export async function stubWebGPU(page: Page, withAdapter = true): Promise<void> {
  await page.addInitScript(installStub, withAdapter);
  await assertTestOrigin(page);
  await page.evaluate(installStub, withAdapter);
}
