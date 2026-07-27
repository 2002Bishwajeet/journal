/**
 * Boot progress store for the splash screen's linear progress bar.
 *
 * Phases are real boot milestones, each mapped to a cumulative percentage.
 * Progress is monotonic — a phase reported late (or twice) never moves the
 * bar backwards. The splash never reaches 100% via a phase: the app UI
 * replacing the splash IS the completion signal.
 */
export type BootPhase = 'react' | 'db-start' | 'db-worker' | 'db-ready' | 'notes-rendered';

// Weights reflect real cost: PGlite's WASM fetch/compile (db-worker) is the
// long pole of a cold boot; schema init and first data emit are quick.
const PHASE_PROGRESS: Record<BootPhase, number> = {
    react: 10,
    'db-start': 25,
    'db-worker': 65,
    'db-ready': 85,
    'notes-rendered': 95,
};

let progress = 0;
const listeners = new Set<() => void>();

// Timestamp (ms since navigation start) of the first time each phase was
// reported. Boot is a one-shot sequence, so the whole cold-start profile —
// including the db-start → first note critical path — reads off these.
const phaseTimes: Partial<Record<BootPhase, number>> = {};

export function reportBootPhase(phase: BootPhase): void {
    const next = PHASE_PROGRESS[phase];
    if (next <= progress) return;
    phaseTimes[phase] = performance.now();
    progress = next;
    if (phase === 'notes-rendered') logBootTimings();
    listeners.forEach((listener) => listener());
}

/** Cold-boot profile, logged once when the note list first renders. */
function logBootTimings(): void {
    const mark = (phase: BootPhase) => Math.round(phaseTimes[phase] ?? 0);
    const line = `[Boot] db-start → first note: ${mark('notes-rendered') - mark('db-start')}ms`;
    const marks = {
        react: mark('react'),
        dbStart: mark('db-start'),
        dbWorker: mark('db-worker'),
        dbReady: mark('db-ready'),
        firstNote: mark('notes-rendered'),
    };
    // Origin bytes, logged alongside the timings so the two can be correlated
    // across boots: PGlite reads its whole data dir out of IndexedDB before
    // Postgres accepts a query, so if this grows and dbWorker grows with it,
    // the IDB sync is the long pole. If this stays small while dbWorker stays
    // slow, it's the 8.7 MB WASM compile and no amount of VACUUM would help.
    Promise.resolve(navigator.storage?.estimate?.())
        .then((est) => console.log(line, { ...marks, storageMB: est?.usage ? +(est.usage / 1048576).toFixed(1) : null }))
        .catch(() => console.log(line, marks));
}

export function getBootProgress(): number {
    return progress;
}

/** Subscribe to progress changes; returns an unsubscribe function. */
export function subscribeBootProgress(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
