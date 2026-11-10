const DAY_MS = 86_400_000;
const MAX_SNAPSHOTS = 50;
/** A note's snapshots may total this many times its current state, or BUDGET_FLOOR, whichever is larger (#1054). */
const BUDGET_STATES = 3;
const BUDGET_FLOOR = 32 * 1024;

/** UTC date of the Monday that starts `d`'s ISO week. */
function isoWeekStart(d: Date): string {
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
}

/**
 * Which snapshots to delete: keep everything under 24 h old, the newest per UTC
 * day up to 30 days, the newest per ISO week (UTC) after that, then cap at 50
 * by dropping the oldest. With sizes, weekly snapshots then go oldest first until
 * the rest fit the byte budget: 3 × the newest snapshot (the note's current state)
 * or 32 KB, whichever is larger. The newest snapshot is always kept.
 */
export function selectSnapshotsToPrune(
    snaps: { id: number; createdAt: Date; bytes?: number }[],
    now: Date,
): number[] {
    const newestFirst = [...snaps].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    );
    const seen = new Set<string>();
    const keep: typeof snaps = [];
    const prune: number[] = [];

    for (const snap of newestFirst) {
        const age = now.getTime() - snap.createdAt.getTime();
        const bucket =
            age < DAY_MS ? null
            : age < 30 * DAY_MS ? `day:${snap.createdAt.toISOString().slice(0, 10)}`
            : `week:${isoWeekStart(snap.createdAt)}`;

        if (bucket && seen.has(bucket)) {
            prune.push(snap.id);
        } else {
            if (bucket) seen.add(bucket);
            keep.push(snap);
        }
    }

    const kept = keep.slice(0, MAX_SNAPSHOTS);
    prune.push(...keep.slice(MAX_SNAPSHOTS).map((snap) => snap.id));

    const budget = Math.max(BUDGET_STATES * (kept[0]?.bytes ?? 0), BUDGET_FLOOR);
    let total = kept.reduce((sum, snap) => sum + (snap.bytes ?? 0), 0);
    // Oldest first, and only weekly ones (30 days or older), so the recent days stay listed
    for (let i = kept.length - 1; i > 0 && total > budget; i--) {
        if (now.getTime() - kept[i].createdAt.getTime() < 30 * DAY_MS) break;
        prune.push(kept[i].id);
        total -= kept[i].bytes ?? 0;
    }
    return prune;
}
