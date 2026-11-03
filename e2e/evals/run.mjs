// `npm run eval:ai -- <model id> [<model id>...]` or `npm run eval:ai -- --all` (#706).
// Playwright takes no model ids, so they reach the spec as EVAL_MODELS.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const models = args.includes('--all') ? 'all' : args.join(',');
if (!models) {
  console.error('Usage: npm run eval:ai -- <model id> | --all');
  process.exit(1);
}
const { status } = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.evals.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, EVAL_MODELS: models },
});
process.exit(status ?? 1);
