// `npm run eval:ai -- [--gpu igpu|dgpu] <model id>... | --all | --candidates` (#706, #1022).
// Playwright takes no model ids, so they reach the spec as EVAL_MODELS, and the GPU as EVAL_GPU.
import { spawnSync } from 'node:child_process';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';

/** The candidates of #1023, with Qwen3 1.7B and Qwen3 4B as the reference. */
const CANDIDATES = [
  'Qwen3-1.7B-q4f16_1-MLC',
  'Qwen3-4B-q4f16_1-MLC',
  'Qwen3.5-2B-q4f16_1-MLC',
  'Qwen3.5-4B-q4f16_1-MLC',
  'Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC',
  'gemma-4-E2B-it-q4f16_1-MLC',
  'Phi-4-mini-instruct-q4f16_1-MLC',
];
/** Too large for the 4 GB graphics card; the integrated GPU can use half of the RAM. */
const IGPU_CANDIDATES = ['Qwen3.5-9B-q4f16_1-MLC', 'Qwen3-8B-q4f16_1-MLC', 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC'];

const usage = () => {
  console.error('Usage: npm run eval:ai -- [--gpu igpu|dgpu] <model id>... | --all | --candidates');
  process.exit(1);
};

const args = process.argv.slice(2);
const gpuAt = args.indexOf('--gpu');
const gpu = gpuAt === -1 ? 'dgpu' : args.splice(gpuAt, 2)[1];
if (gpu !== 'igpu' && gpu !== 'dgpu') usage();

let models;
if (args.includes('--all')) models = 'all';
else if (args.includes('--candidates')) models = [...CANDIDATES, ...(gpu === 'igpu' ? IGPU_CANDIDATES : [])].join(',');
else {
  const known = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id));
  const unknown = args.filter((id) => !known.has(id));
  if (unknown.length) {
    console.error(`Not in web-llm's prebuiltAppConfig: ${unknown.join(', ')}`);
    process.exit(1);
  }
  models = args.join(',');
}
if (!models) usage();

const { status } = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.evals.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, EVAL_MODELS: models, EVAL_GPU: gpu },
});
process.exit(status ?? 1);
