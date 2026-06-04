import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatLastEditedAt } from '@/lib/utils';

describe('formatLastEditedAt', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null for falsy values', () => {
        expect(formatLastEditedAt(undefined)).toBeNull();
        expect(formatLastEditedAt(null)).toBeNull();
        expect(formatLastEditedAt('')).toBeNull();
        expect(formatLastEditedAt(0)).toBeNull();
    });

    it('returns null for unparseable strings', () => {
        expect(formatLastEditedAt('not-a-date')).toBeNull();
    });

    it('returns "Just now" for timestamps less than 1 minute ago', () => {
        vi.useFakeTimers();
        const now = new Date('2026-06-04T12:00:00Z').getTime();
        vi.setSystemTime(now);
        expect(formatLastEditedAt(now - 30_000)).toBe('Just now');
    });

    it('returns minutes ago for timestamps 1-59 minutes ago', () => {
        vi.useFakeTimers();
        const now = new Date('2026-06-04T12:00:00Z').getTime();
        vi.setSystemTime(now);
        expect(formatLastEditedAt(now - 5 * 60_000)).toBe('5m ago');
        expect(formatLastEditedAt(now - 59 * 60_000)).toBe('59m ago');
    });

    it('returns hours ago for timestamps 1-23 hours ago', () => {
        vi.useFakeTimers();
        const now = new Date('2026-06-04T12:00:00Z').getTime();
        vi.setSystemTime(now);
        expect(formatLastEditedAt(now - 2 * 3_600_000)).toBe('2h ago');
        expect(formatLastEditedAt(now - 23 * 3_600_000)).toBe('23h ago');
    });

    it('returns days ago for timestamps 1-6 days ago', () => {
        vi.useFakeTimers();
        const now = new Date('2026-06-04T12:00:00Z').getTime();
        vi.setSystemTime(now);
        expect(formatLastEditedAt(now - 3 * 86_400_000)).toBe('3d ago');
    });

    it('returns locale date string for timestamps 7+ days ago', () => {
        vi.useFakeTimers();
        const now = new Date('2026-06-04T12:00:00Z').getTime();
        vi.setSystemTime(now);
        const old = new Date('2026-05-01T00:00:00Z');
        const result = formatLastEditedAt(old.toISOString());
        expect(result).toBe(old.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
    });

    it('accepts ISO string timestamps', () => {
        vi.useFakeTimers();
        const now = new Date('2026-06-04T12:00:00Z').getTime();
        vi.setSystemTime(now);
        expect(formatLastEditedAt('2026-06-04T11:55:00Z')).toBe('5m ago');
    });
});
