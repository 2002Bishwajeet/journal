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
const PHASE_PROGRESS: Record<BootPhase, number> = {
    react: 10,
    'db-start': 25,
    'db-worker': 65,
    'db-ready': 85,
};

let progress = 0;
const listeners = new Set<() => void>();

export function reportBootPhase(phase: BootPhase): void {
    const next = PHASE_PROGRESS[phase];
    if (next <= progress) return;
    progress = next;
    listeners.forEach((listener) => listener());
}

export function getBootProgress(): number {
    return progress;
}

/** Subscribe to progress changes; returns an unsubscribe function. */
export function subscribeBootProgress(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
