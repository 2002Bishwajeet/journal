// Names this run's isolation folder once, before any worker starts, so every
// live spec (via the `liveRun` fixture in ../fixtures.ts) and
// global-teardown.ts agree on the same folder without a file hand-off —
// process.env set here is inherited by worker processes and by
// globalTeardown. See e2e/README.md's live-tier section.
export default async function globalSetup(): Promise<void> {
    const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const random = Math.random().toString(36).slice(2, 8);
    process.env.E2E_LIVE_RUN_FOLDER = `e2e-${iso}-${random}`;
}
