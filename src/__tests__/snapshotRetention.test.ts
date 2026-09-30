import { describe, it, expect } from 'vitest';
import { selectSnapshotsToPrune } from '@/lib/history/retention';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A Wednesday, so day/week boundaries are easy to reason about.
const NOW = new Date('2026-06-17T12:00:00Z');

let nextId = 1;
function snap(ageMs: number) {
    return { id: nextId++, createdAt: new Date(NOW.getTime() - ageMs) };
}

function kept(snaps: { id: number; createdAt: Date }[]) {
    const pruned = new Set(selectSnapshotsToPrune(snaps, NOW));
    return snaps.filter((s) => !pruned.has(s.id));
}

describe('selectSnapshotsToPrune', () => {
    it('keeps every snapshot younger than 24 hours', () => {
        const snaps = Array.from({ length: 20 }, (_, i) => snap(i * HOUR));
        expect(selectSnapshotsToPrune(snaps, NOW)).toEqual([]);
    });

    it('keeps only the newest snapshot per UTC day between 24 hours and 30 days', () => {
        // Three snapshots on each of days 2..30 ago, spread across the UTC day.
        const snaps = [];
        for (let d = 2; d <= 29; d++) {
            const dayStart = Date.UTC(2026, 5, 17 - d);
            for (const h of [1, 9, 20]) {
                snaps.push({ id: nextId++, createdAt: new Date(dayStart + h * HOUR) });
            }
        }

        const survivors = kept(snaps);

        expect(survivors).toHaveLength(28);
        const days = survivors.map((s) => s.createdAt.toISOString().slice(0, 10));
        expect(new Set(days).size).toBe(28);
        // The survivor of each day is its newest (20:00 UTC).
        expect(survivors.every((s) => s.createdAt.getUTCHours() === 20)).toBe(true);
    });

    it('keeps only the newest snapshot per ISO week beyond 30 days', () => {
        // Mon 2026-03-02 .. Sun 2026-03-15: two ISO weeks, one snapshot a day.
        const snaps = Array.from({ length: 14 }, (_, i) => ({
            id: nextId++,
            createdAt: new Date(Date.UTC(2026, 2, 2 + i, 12)),
        }));

        const survivors = kept(snaps);

        expect(survivors.map((s) => s.createdAt.toISOString().slice(0, 10))).toEqual([
            '2026-03-08', // Sunday of the first week
            '2026-03-15', // Sunday of the second week
        ]);
    });

    it('prunes the oldest down to 50 when more remain', () => {
        const snaps = Array.from({ length: 60 }, (_, i) => snap(i * 60_000)); // all < 24 h
        const pruned = selectSnapshotsToPrune(snaps, NOW);

        expect(pruned).toHaveLength(10);
        // The ten oldest go.
        expect(pruned.sort((a, b) => a - b)).toEqual(snaps.slice(50).map((s) => s.id));
    });

    it('never prunes the newest snapshot', () => {
        const cases = [
            [snap(40 * DAY), snap(40 * DAY + HOUR)],
            [snap(3 * DAY), snap(3 * DAY + HOUR)],
            Array.from({ length: 80 }, (_, i) => snap(i * HOUR)),
        ];
        for (const snaps of cases) {
            const newest = snaps.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
            expect(selectSnapshotsToPrune(snaps, NOW)).not.toContain(newest.id);
        }
    });

    it('does not depend on input order', () => {
        const snaps = [snap(5 * DAY + HOUR), snap(5 * DAY), snap(5 * DAY + 2 * HOUR)];
        const reversed = [...snaps].reverse();
        expect(selectSnapshotsToPrune(snaps, NOW).sort()).toEqual(
            selectSnapshotsToPrune(reversed, NOW).sort(),
        );
        expect(selectSnapshotsToPrune(snaps, NOW)).not.toContain(snaps[1].id);
    });
});
