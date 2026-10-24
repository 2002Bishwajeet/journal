import type { Page } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';

// Stands in for the WebLLM engine worker (src/lib/webllm/worker.ts), speaking the
// WebWorkerMLCEngine message protocol.
//  - A reload reports progress, then waits for the test to post 'ok' or 'fail' on the
//    `e2e-webllm` BroadcastChannel; every reload's model id is posted on `e2e-webllm-log`.
//  - A chat completion answers with the next queued reply (`queueReply`), waiting for one
//    if the queue is empty. A `null` reply never answers until the engine is interrupted,
//    like a slow generation that Stop cuts short. The request's messages are posted on
//    `e2e-webllm-requests`.
const FAKE_WORKER = `
const pending = [];
const replies = [];
const waiting = [];
const hanging = [];
const log = new BroadcastChannel('e2e-webllm-log');
const requests = new BroadcastChannel('e2e-webllm-requests');
const completion = (content) => ({ id: 'stub', object: 'chat.completion', model: 'stub', created: 0, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
function flush() {
  while (replies.length && waiting.length) {
    const reply = replies.shift();
    const uuid = waiting.shift();
    if (reply === null) hanging.push(uuid);
    else self.postMessage({ kind: 'return', uuid, content: completion(reply) });
  }
}
new BroadcastChannel('e2e-webllm').onmessage = ({ data }) => {
  if (data === 'ok' || data === 'fail') {
    for (const uuid of pending.splice(0)) {
      self.postMessage(data === 'ok'
        ? { kind: 'return', uuid, content: null }
        : { kind: 'throw', uuid, content: 'stub load failure' });
    }
  } else {
    replies.push(data.reply);
    flush();
  }
};
self.onmessage = ({ data }) => {
  if (data.kind === 'chatCompletionNonStreaming') {
    requests.postMessage(JSON.stringify(data.content.request.messages));
    waiting.push(data.uuid);
    flush();
    return;
  }
  if (data.kind === 'interruptGenerate') {
    for (const uuid of hanging.splice(0)) self.postMessage({ kind: 'return', uuid, content: completion('') });
  }
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

type StubWindow = Window & { __webllmReloads?: string[]; __webllmRequests?: string[] };

export async function stubWebLLMWorker(page: Page): Promise<void> {
  // Keep the served headers: under the app's COEP a worker script without one is blocked.
  await page.context().route(isWebLLMWorker, async (route) =>
    route.fulfill({ response: await route.fetch(), body: FAKE_WORKER }),
  );
  await assertTestOrigin(page);
  await page.evaluate(() => {
    const w = window as StubWindow;
    w.__webllmReloads = [];
    w.__webllmRequests = [];
    new BroadcastChannel('e2e-webllm-log').onmessage = ({ data }) => w.__webllmReloads!.push(data);
    new BroadcastChannel('e2e-webllm-requests').onmessage = ({ data }) => w.__webllmRequests!.push(data);
  });
}

export async function finishLoad(page: Page, outcome: 'ok' | 'fail'): Promise<void> {
  await page.evaluate((o) => new BroadcastChannel('e2e-webllm').postMessage(o), outcome);
}

/** The model ids the worker was asked to load, in order. */
export const reloads = (page: Page) => page.evaluate(() => (window as StubWindow).__webllmReloads);

/** Queues what the next chat completion answers: a string, or `null` to never answer. */
export async function queueReply(page: Page, reply: string | object | null): Promise<void> {
  const content = reply === null || typeof reply === 'string' ? reply : JSON.stringify(reply);
  await page.evaluate((r) => new BroadcastChannel('e2e-webllm').postMessage({ reply: r }), content);
}

/** The messages of every chat completion the worker received, as JSON text. */
export const completionRequests = (page: Page) => page.evaluate(() => (window as StubWindow).__webllmRequests);
