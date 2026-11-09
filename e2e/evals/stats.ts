// The AI eval's results, speed figures and table (#706, #1022). Pure, so src/__tests__/agentEvalStats.test.ts can test them.
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { getModelInfo } from '../../src/lib/webllm/models';
import type { TaskKind } from './tasks';

/** One model turn's usage, as web-llm reports it. */
export interface Turn {
    promptTokens: number;
    completionTokens: number;
    prefillTokensPerS: number;
    decodeTokensPerS: number;
}

/** The `p`th percentile (0-100), interpolated between the closest two values; null with no values. */
export function percentile(values: number[], p: number): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = ((sorted.length - 1) * p) / 100;
    const low = Math.floor(rank);
    return sorted[low] + (sorted[Math.ceil(rank)] - sorted[low]) * (rank - low);
}

/** A model's speed over its tasks: median tok/s over every turn, average prompt tokens per turn, p50/p90 task time. */
export function speedOf(tasks: { wallMs: number; turns: Turn[] }[]) {
    const turns = tasks.flatMap((t) => t.turns);
    const wall = tasks.map((t) => t.wallMs);
    return {
        prefillTokensPerS: percentile(turns.map((t) => t.prefillTokensPerS), 50),
        decodeTokensPerS: percentile(turns.map((t) => t.decodeTokensPerS), 50),
        promptTokensPerTurn: turns.length ? turns.reduce((sum, t) => sum + t.promptTokens, 0) / turns.length : null,
        p50Ms: percentile(wall, 50),
        p90Ms: percentile(wall, 90),
    };
}

export interface TaskResult {
    id: string;
    kind: TaskKind;
    success: boolean;
    steps: number;
    invalidCalls: number;
    wallMs: number;
    /** Each model turn's usage, in order. */
    turns: Turn[];
    answer: string | null;
    /** Each tool call, with the start of its result (or, for a proposal, the user's answer). */
    calls: { tool: string; args: unknown; result?: string }[];
    /** Why each invalid call failed: not JSON, an unknown tool, bad args, or the tool refused it. */
    errors: string[];
    /** The run itself broke (a timeout, say), so the task could not be checked. */
    error?: string;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Which machine a result file comes from, so runs on different machines do not overwrite each other (#1023):
 * `EVAL_MACHINE` when set, else the adapter's vendor and architecture plus the host name's first label.
 */
export function machineTag(adapter: ModelResult['adapter'], hostname: string, override?: string): string {
    if (override) return slug(override);
    return slug([adapter?.vendor, adapter?.architecture, hostname.split('.')[0]].filter(Boolean).join('-'));
}

export interface ModelResult {
    model: string;
    /** `model`, or its q4f32 twin on a GPU without shader-f16. */
    loadedModelId: string;
    date: string;
    gpu: 'igpu' | 'dgpu';
    /** The WebGPU adapter web-llm loads on; null with no WebGPU. */
    adapter: { vendor: string; architecture: string; shaderF16: boolean } | null;
    firstLoadMs: number;
    /** The weights were already downloaded, so the first load did not include the download. */
    cached: boolean;
    loadError?: string;
    /** The engine threw in the first task, so the other tasks did not run. */
    generationError?: string;
    tasks: TaskResult[];
}

const KINDS: TaskKind[] = ['find', 'read', 'edit', 'cross', 'refusal', 'long'];
const seconds = (ms: number | null) => (ms === null ? '' : `${(ms / 1000).toFixed(1)} s`);
const round = (n: number | null) => (n === null ? '' : String(Math.round(n)));

function score(tasks: TaskResult[]) {
    return `${tasks.filter((t) => t.success).length}/${tasks.length}`;
}

export function markdownTable(rows: ModelResult[]): string {
    const vram = new Map(prebuiltAppConfig.model_list.map((m) => [m.model_id, m.vram_required_MB]));
    const lines = [
        '| Model | GPU | VRAM | Success | Find | Read | Edit | Cross-note | Refusal | Long note | Avg steps | Invalid calls | Prefill tok/s | Decode tok/s | Prompt tokens/turn | p50 task | p90 task | First load |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rows) {
        const name = `${getModelInfo(r.model)?.name ?? r.model} (\`${r.loadedModelId}\`)`;
        const adapter = r.adapter ? `${r.adapter.vendor} ${r.adapter.architecture}${r.adapter.shaderF16 ? '' : ', no shader-f16'}` : 'no WebGPU';
        const mb = vram.get(r.loadedModelId);
        const head = `| ${name} | ${r.gpu} (${adapter}) | ${mb ? `${(mb / 1000).toFixed(1)} GB` : '?'} |`;
        // A model that loads but then fails every run (out of GPU memory, say) gets no scores either.
        const failure = r.loadError
            ? `load failed: ${r.loadError}`
            : r.generationError
              ? `first task failed: ${r.generationError}`
              : r.tasks.every((t) => t.error) && `every run failed: ${r.tasks[0]?.error}`;
        if (failure) {
            lines.push(`${head} ${failure} |${' |'.repeat(14)}`);
            continue;
        }
        // The 20 tasks of #706; the long-note tasks are scored on their own.
        const core = r.tasks.filter((t) => t.kind !== 'long');
        const sum = (f: (t: TaskResult) => number) => r.tasks.reduce((s, t) => s + f(t), 0);
        const speed = speedOf(r.tasks);
        lines.push(
            `${head} ${score(core)} | ${KINDS.map((k) => score(r.tasks.filter((t) => t.kind === k))).join(' | ')} | ${(sum((t) => t.steps) / (r.tasks.length || 1)).toFixed(1)} | ${sum((t) => t.invalidCalls)} | ${round(speed.prefillTokensPerS)} | ${round(speed.decodeTokensPerS)} | ${round(speed.promptTokensPerTurn)} | ${seconds(speed.p50Ms)} | ${seconds(speed.p90Ms)} | ${seconds(r.firstLoadMs)}${r.cached ? '' : ' (with download)'} |`,
        );
    }
    return lines.join('\n');
}
