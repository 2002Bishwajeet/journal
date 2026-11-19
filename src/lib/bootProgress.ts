/**
 * Boot progress store for the splash screen's linear progress bar.
 *
 * Phases are real boot milestones, each mapped to a cumulative percentage.
 * Progress is monotonic — a phase reported late (or twice) never moves the
 * bar backwards. The splash never reaches 100% via a phase: the app UI
 * replacing the splash IS the completion signal.
 */
export type BootPhase = 'react' | 'db-start' | 'db-worker' | 'db-ready';

// Weights reflect real cost: PGlite's WASM fetch/compile (db-worker) is the
// long pole of a cold boot; schema init and first data emit are quick.
export const PHASE_PROGRESS: Record<BootPhase, number> = {
    react: 10,
    'db-start': 25,
    'db-worker': 65,
    'db-ready': 85,
};

let progress = 0;
let openProgress: OpenProgress | null = null;
let bootError: Error | null = null;
let bootFailures = 0;
const listeners = new Set<() => void>();

/** How far an encrypted database's open has got, and when it began (#1365). */
export interface OpenProgress {
    startedAt: number;
    percent: number;
}

/** The splash shows the open's progress only past this, so a fast open doesn't flash it. */
export const OPEN_PROGRESS_DELAY_MS = 300;

/** pglite-cipher's blocks read as a whole percent; a store with no blocks counts as done. */
export function openPercent(done: number, total: number): number {
    if (total <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/** An encrypted open begins: its progress starts at 0 and its delay clock starts now. */
export function startOpenProgress(): void {
    openProgress = { startedAt: Date.now(), percent: 0 };
    listeners.forEach((listener) => listener());
}

/** Monotonic like the boot bar. Ignored unless an open has begun. */
export function reportOpenProgress(done: number, total: number): void {
    if (!openProgress) return;
    const percent = openPercent(done, total);
    if (percent <= openProgress.percent) return;
    openProgress = { ...openProgress, percent };
    listeners.forEach((listener) => listener());
}

/** The open is over: the splash stops showing it, whatever the delay says. */
export function finishOpenProgress(): void {
    if (!openProgress) return;
    openProgress = null;
    listeners.forEach((listener) => listener());
}

export function getOpenProgress(): OpenProgress | null {
    return openProgress;
}

/**
 * A boot timing mark, `journal-boot:<step>` in `performance.getEntriesByType('mark')`,
 * which the iOS Safari check reads to find the step a stuck boot stalls on (#806).
 * `startTime` places a step timed elsewhere (the database worker) on this page's clock.
 */
export function markBoot(step: string, startTime?: number): void {
    performance.mark(`journal-boot:${step}`, startTime === undefined ? undefined : { startTime });
}

export function reportBootPhase(phase: BootPhase): void {
    markBoot(phase);
    const next = PHASE_PROGRESS[phase];
    if (next <= progress) return;
    progress = next;
    listeners.forEach((listener) => listener());
}

export function getBootProgress(): number {
    return progress;
}

/**
 * The database could not be opened, so the app has no local store to run on.
 * Set instead of booting an empty database, which would let the user write into
 * a journal that is about to be replaced by their migrated data.
 */
export function reportBootError(error: Error): void {
    bootError = error;
    bootFailures += 1;
    listeners.forEach((listener) => listener());
}

/** Failed boot attempts this session — a repeat failure is unlikely to be transient. */
export function getBootFailureCount(): number {
    return bootFailures;
}

export function clearBootError(): void {
    bootFailures = 0;
    if (!bootError) return;
    bootError = null;
    listeners.forEach((listener) => listener());
}

export function getBootError(): Error | null {
    return bootError;
}

/** Subscribe to progress changes; returns an unsubscribe function. */
export function subscribeBootProgress(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
