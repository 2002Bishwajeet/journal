import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getNoteGroup } from './dateGrouping';

describe('getNoteGroup', () => {
    // Mock "now" to a fixed date: Wednesday, January 15, 2025
    // This makes:
    // Today: Jan 15
    // Yesterday: Jan 14
    // Monday (This week): Jan 13
    // Sunday (Last week/Recent): Jan 12
    const MOCK_NOW = new Date(2025, 0, 15, 12, 0, 0); // Jan is month 0

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should group "Today" correctly', () => {
        const today = new Date(2025, 0, 15, 9, 30);
        expect(getNoteGroup(today.toISOString())).toBe('Today');
    });

    it('should group "Yesterday" correctly', () => {
        const yesterday = new Date(2025, 0, 14, 18, 45);
        expect(getNoteGroup(yesterday.toISOString())).toBe('Yesterday');
    });

    it('should group days within the last 7 days by day name', () => {
        // Jan 13 is a Monday (2 days ago)
        const monday = new Date(2025, 0, 13, 10, 0);
        expect(getNoteGroup(monday.toISOString())).toBe('Monday');

        // Jan 10 is a Friday (5 days ago)
        const friday = new Date(2025, 0, 10, 14, 0);
        expect(getNoteGroup(friday.toISOString())).toBe('Friday');
    });

    it('should group "Last Week" (8-14 days ago)', () => {
        // Jan 7 is 8 days ago
        const eightDaysAgo = new Date(2025, 0, 7, 10, 0);
        expect(getNoteGroup(eightDaysAgo.toISOString())).toBe('Last Week');

        // Jan 1 is 14 days ago
        const fourteenDaysAgo = new Date(2025, 0, 1, 10, 0);
        expect(getNoteGroup(fourteenDaysAgo.toISOString())).toBe('Last Week');
    });

    it('should group "2 Weeks Ago" (15-21 days ago)', () => {
        // Dec 31, 2024 is 15 days ago
        const fifteenDaysAgo = new Date(2024, 11, 31, 10, 0);
        expect(getNoteGroup(fifteenDaysAgo.toISOString())).toBe('2 Weeks Ago');

        // Dec 25, 2024 is 21 days ago
        const twentyOneDaysAgo = new Date(2024, 11, 25, 10, 0);
        expect(getNoteGroup(twentyOneDaysAgo.toISOString())).toBe('2 Weeks Ago');
    });

    it('should group by Month for older dates in the same year', () => {
        // However, our mock is Jan 15, so older dates in same year (2025) don't exist yet in the past
        // Let's shift the perspective or test a future scenario if needed, 
        // OR test the "Last Month" logic if we were in Feb.

        // Let's temporarily change "now" to Feb 15, 2025 for this test
        vi.setSystemTime(new Date(2025, 1, 15)); // Feb 15

        // Jan 15 (31 days ago) -> Should be "January"
        const janDate = new Date(2025, 0, 15);
        expect(getNoteGroup(janDate.toISOString())).toBe('January');
    });

    it('should group by Month Year for dates in previous years', () => {
        // Back to original mock: Jan 15, 2025

        // Nov 2024 (~45+ days ago) -> "November 2024"
        const oldDate = new Date(2024, 10, 15);
        expect(getNoteGroup(oldDate.toISOString())).toBe('November 2024');
    });
});
