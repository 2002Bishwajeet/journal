import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { test, expect, waitForAppReady } from '../fixtures';
import { assertNoFenceViolations, installNetworkFence } from '../support/network-fence';
import { assertTestOrigin } from '../support/origin-guard';
import { activeTitleInput, openNote, selectFolder } from '../support/actions';
import { getModelInfo, getModelsForJob } from '../../src/lib/webllm/models';
import { blocksOf, fixtureFiles, TASKS, type EvalTask, type TaskKind } from './tasks';

// The AI eval (#706): each model runs every task in the real app, with the real WebLLM worker
// on this machine's GPU, and every proposal accepted. Run with `npm run eval:ai -- <model id>`
// or `-- --all`; results go to e2e/evals/results/<date>-<model>.json.

/** The editor model the agent candidates are compared against. */
const FLOOR_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const MODELS = process.env.EVAL_MODELS === 'all'
    ? [...getModelsForJob('agent').map((m) => m.id), FLOOR_MODEL_ID]
    : (process.env.EVAL_MODELS ?? '').split(',').filter(Boolean);

// Downloaded weights stay in this profile's Cache Storage between runs; the app's own data is cleared per model.
const PROFILE_DIR = path.join(homedir(), '.cache', 'journal-ai-evals', 'chromium');
const RESULTS_DIR = path.resolve('e2e/evals/results');
/** Only the model files may leave the machine: Hugging Face (and its CDNs) and the model libraries on GitHub. */
const MODEL_HOST = /(^|\.)(huggingface\.co|hf\.co)$|^raw\.githubusercontent\.com$/;
const TASK_TIMEOUT = 10 * 60_000;
const KINDS: TaskKind[] = ['find', 'read', 'edit', 'cross', 'refusal'];

interface TaskResult {
    id: string;
    kind: TaskKind;
    success: boolean;
    steps: number;
    invalidCalls: number;
    wallMs: number;
    answer: string | null;
    /** Each tool call, with the start of its result (or, for a proposal, the user's answer). */
    calls: { tool: string; args: unknown; result?: string }[];
    /** Why each invalid call failed: not JSON, an unknown tool, bad args, or the tool refused it. */
    errors: string[];
    /** The run itself broke (a timeout, say), so the task could not be checked. */
    error?: string;
}

interface ModelResult {
    model: string;
    loadedModelId: string;
    date: string;
    gpu: string;
    firstLoadMs: number;
    /** The weights were already downloaded, so the first load did not include the download. */
    cached: boolean;
    loadError?: string;
    tasks: TaskResult[];
}

const results: ModelResult[] = [];

async function launch(baseURL: string, modelId: string): Promise<BrowserContext> {
    // Headed where there is a display; over SSH on Linux, headless still gets the GPU through Vulkan.
    const hasDisplay = process.platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: !hasDisplay,
        baseURL,
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
        args: ['--enable-unsafe-webgpu', ...(process.platform === 'linux' ? ['--enable-features=Vulkan', '--use-angle=vulkan'] : [])],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    // A fresh journal each time, but keep Cache Storage, where web-llm keeps the weights.
    await (await context.newCDPSession(page)).send('Storage.clearDataForOrigin', {
        origin: baseURL,
        storageTypes: 'cookies,indexeddb,local_storage,service_workers',
    });
    const { origins } = JSON.parse(readFileSync('e2e/fixtures/hermetic-auth.json', 'utf8')) as {
        origins: { origin: string; localStorage: { name: string; value: string }[] }[];
    };
    const auth = origins.find((o) => o.origin === baseURL)!.localStorage;
    await context.addInitScript(
        ({ origin, auth, settings }) => {
            if (location.origin !== origin) return;
            for (const { name, value } of auth) localStorage.setItem(name, value);
            localStorage.setItem('journal-ai-settings', settings);
        },
        { origin: baseURL, auth, settings: JSON.stringify({ agentModelId: modelId, _v: 2 }) },
    );
    return context;
}

async function importFixture(page: Page) {
    const files = fixtureFiles();
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Data & storage' }).click();
    await dialog
        .locator('input[type="file"]')
        .setInputFiles(files.map(({ name, body }) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(body) })));
    await expect(page.getByText(`Successfully imported ${files.length} notes`)).toBeVisible();
    await page.keyboard.press('Escape');
}

async function closeTabs(page: Page) {
    const closeTab = page.getByRole('button', { name: /^Close (?!assistant)/ });
    while ((await closeTab.count()) > 0) await closeTab.first().click();
}

/** The note's blocks, or null when no note has that title. */
async function noteBlocks(page: Page, title: string) {
    // The note list shows only with no note open.
    await closeTabs(page);
    // Case-sensitive: a model may make a second note whose title differs only in case.
    const button = page.getByRole('button').filter({ hasText: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), visible: true }).first();
    try {
        await expect(button).toBeVisible({ timeout: 5_000 });
    } catch {
        return null;
    }
    await button.click();
    await expect(activeTitleInput(page)).toHaveValue(title);
    const docId = new URL(page.url()).pathname.split('/').filter(Boolean).pop();
    let open: Awaited<ReturnType<NonNullable<Window['__journalE2E']>['openNoteJSON']>> = null;
    await expect.poll(async () => (open = await page.evaluate(() => window.__journalE2E!.openNoteJSON()))?.docId).toBe(docId);
    return blocksOf(open!.doc);
}

/** `consoleErrors`: the page's console errors so far; a new "Agent error" among them means the run broke. */
async function runTask(page: Page, task: EvalTask, consoleErrors: string[]): Promise<TaskResult> {
    await closeTabs(page);
    await openNote(page, task.open);
    await expect(activeTitleInput(page)).toHaveValue(task.open);
    const panel = page.getByRole('region', { name: 'Assistant' });
    const openPanel = page.getByRole('button', { name: 'Open assistant' });
    await expect(panel.or(openPanel)).toBeVisible();
    if (await openPanel.isVisible()) await openPanel.click();
    const input = panel.getByPlaceholder('Type a message or /help...');
    const stop = panel.getByRole('button', { name: 'Stop' });
    await page.evaluate(() => window.__journalE2E!.takeAgentEvents());
    const errorsBefore = consoleErrors.length;

    const start = Date.now();
    let error: string | undefined;
    try {
        await input.fill(task.prompt);
        await page.keyboard.press('Enter');
        // The box empties in the render that starts the run, which can end before Stop is ever seen.
        await expect(input).toHaveValue('');
        await expect(stop).toBeHidden({ timeout: TASK_TIMEOUT });
    } catch (e) {
        error = e instanceof Error ? e.message.split('\n')[0] : String(e);
        if (await stop.isVisible()) await stop.click();
    }
    const wallMs = Date.now() - start;
    error ??= consoleErrors.slice(errorsBefore).find((e) => e.startsWith('Agent error'));
    const events = await page.evaluate(() => window.__journalE2E!.takeAgentEvents());
    const calls: TaskResult['calls'] = [];
    for (const e of events) {
        if (e.type === 'toolCall') calls.push({ tool: e.tool!, args: e.args });
        // Long results (a note's markdown) only cost space here.
        if (e.type === 'toolResult') calls[calls.length - 1].result = e.result!.slice(0, 200);
    }
    const errors = events.filter((e) => e.type === 'error').map((e) => e.error!);
    const answer = events.findLast((e) => e.type === 'answer')?.answer ?? null;
    let blocks = null;
    try {
        blocks = task.target ? await noteBlocks(page, task.target) : null;
    } catch (e) {
        error ??= `Could not read ${task.target}: ${e instanceof Error ? e.message.split('\n')[0] : e}`;
    }
    return {
        id: task.id,
        kind: task.kind,
        success: !error && task.check({ answer, tools: calls.map((c) => c.tool), blocks }),
        steps: events.filter((e) => e.type === 'step').length,
        invalidCalls: errors.length,
        wallMs,
        answer,
        calls,
        errors,
        ...(error && { error }),
    };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function score(tasks: TaskResult[], kind?: TaskKind) {
    const of = kind ? tasks.filter((t) => t.kind === kind) : tasks;
    return `${of.filter((t) => t.success).length}/${of.length}`;
}

function markdownTable(rows: ModelResult[]): string {
    const lines = [
        '| Model | VRAM | Success | Find | Read | Edit | Cross-note | Refusal | Avg steps | Invalid calls | Avg time per task | First load |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rows) {
        const info = getModelInfo(r.model);
        const name = `${info?.name ?? r.model} (\`${r.loadedModelId}\`)`;
        // A model that loads but then fails every run (out of GPU memory, say) gets no scores either.
        const failure = r.loadError ? `load failed: ${r.loadError}` : r.tasks.every((t) => t.error) && `every run failed: ${r.tasks[0]?.error}`;
        if (failure) {
            lines.push(`| ${name} | ${info?.memoryUsage ?? '?'} | ${failure} | | | | | | | | | |`);
            continue;
        }
        const n = r.tasks.length || 1;
        const sum = (f: (t: TaskResult) => number) => r.tasks.reduce((s, t) => s + f(t), 0);
        lines.push(
            `| ${name} | ${info?.memoryUsage ?? '?'} | ${score(r.tasks)} | ${KINDS.map((k) => score(r.tasks, k)).join(' | ')} | ${(sum((t) => t.steps) / n).toFixed(1)} | ${sum((t) => t.invalidCalls)} | ${seconds(sum((t) => t.wallMs) / n)} | ${seconds(r.firstLoadMs)}${r.cached ? '' : ' (with download)'} |`,
        );
    }
    return lines.join('\n');
}

for (const modelId of MODELS) {
    test(`agent eval: ${modelId}`, async ({ baseURL }) => {
        const context = await launch(baseURL!, modelId);
        const { violations } = await installNetworkFence(context);
        await context.route((url) => MODEL_HOST.test(url.hostname), (route) => route.continue());
        try {
            const page = context.pages()[0];
            const consoleErrors: string[] = [];
            page.on('console', (msg) => {
                if (msg.type() === 'error') consoleErrors.push(msg.text());
            });
            await page.goto('/');
            await assertTestOrigin(page);
            // On a cold start the dev server reloads the page once, after it optimizes the dependencies.
            await waitForAppReady(page).catch(() => waitForAppReady(page));
            await importFixture(page);
            await selectFolder(page, 'Main');

            const gpu = await page.evaluate(async () => {
                type Adapter = { info?: { vendor: string; architecture: string } };
                const { gpu } = navigator as Navigator & { gpu?: { requestAdapter(options: object): Promise<Adapter | null> } };
                const info = (await gpu?.requestAdapter({ powerPreference: 'high-performance' }))?.info;
                return info ? `${info.vendor} ${info.architecture}`.trim() : 'none';
            });
            const load = await page.evaluate((id) => window.__journalE2E!.startAgentEval(id), modelId);
            const result: ModelResult = {
                model: modelId,
                loadedModelId: load.loadedModelId,
                date: new Date().toISOString().slice(0, 10),
                gpu,
                firstLoadMs: load.loadMs,
                cached: load.cached,
                ...(!load.loaded && { loadError: consoleErrors.find((e) => e.includes('[WebLLM]')) ?? 'the model did not load' }),
                tasks: [],
            };
            if (load.loaded) {
                for (const task of TASKS) {
                    const taskResult = await runTask(page, task, consoleErrors);
                    console.log(`${modelId} ${task.id}: ${taskResult.success ? 'ok' : 'FAIL'} (${taskResult.calls.map((c) => c.tool).join(', ') || 'no tools'})`);
                    result.tasks.push(taskResult);
                }
            }
            results.push(result);
            mkdirSync(RESULTS_DIR, { recursive: true });
            writeFileSync(path.join(RESULTS_DIR, `${result.date}-${modelId}.json`), `${JSON.stringify(result, null, 2)}\n`);
        } finally {
            await context.close();
        }
        assertNoFenceViolations(violations);
    });
}

test.afterAll(() => {
    if (results.length) console.log(`\n${markdownTable(results)}\n`);
});
