import { describe, it, expect } from 'vitest';
import { buildReminderSchedule, localDateKey, REMINDER_PROMPTS, REMINDER_URL } from '@/lib/reminderSchedule';

const build = (over: Partial<Parameters<typeof buildReminderSchedule>[0]> = {}) =>
    buildReminderSchedule({
        time: '20:00',
        timeZone: 'UTC',
        now: new Date('2026-06-10T12:00:00Z'),
        writtenDates: [],
        ...over,
    });

describe('buildReminderSchedule', () => {
    it('returns 14 consecutive days from today when the time is still ahead', () => {
        const entries = build();
        expect(entries).toHaveLength(14);
        expect(entries[0].at).toBe('2026-06-10T20:00');
        expect(entries[13].date).toBe('2026-06-23');
        expect(entries.map((e) => e.time)).toEqual(Array(14).fill('20:00'));
    });

    it("starts tomorrow when today's time has passed, or is right now", () => {
        expect(build({ now: new Date('2026-06-10T20:30:00Z') })[0].date).toBe('2026-06-11');
        expect(build({ now: new Date('2026-06-10T20:00:00Z') })[0].date).toBe('2026-06-11');
    });

    it('skips days the user already wrote on', () => {
        const entries = build({ writtenDates: ['2026-06-10', '2026-06-12', '2020-01-01'] });
        expect(entries.map((e) => e.date)).not.toContain('2026-06-10');
        expect(entries.map((e) => e.date)).not.toContain('2026-06-12');
        expect(entries).toHaveLength(12);
        expect(entries[0].date).toBe('2026-06-11');
    });

    it('honours a custom number of days', () => {
        expect(build({ days: 3 }).map((e) => e.date)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
    });

    it('uses fixed prompts chosen by date, and always opens today', () => {
        const a = build();
        const b = build({ now: new Date('2026-06-10T09:00:00Z') });
        expect(a).toEqual(b);
        for (const e of a) {
            expect(REMINDER_PROMPTS).toContain(e.body);
            expect(e.url).toBe(REMINDER_URL);
            expect(e.url).toBe('journal://today');
        }
        expect(new Set(a.slice(0, REMINDER_PROMPTS.length).map((e) => e.body)).size).toBe(REMINDER_PROMPTS.length);
        expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    });

    it('is deterministic for the same now and time zone', () => {
        expect(build({ timeZone: 'Europe/Berlin' })).toEqual(build({ timeZone: 'Europe/Berlin' }));
    });

    it('rejects a malformed time', () => {
        expect(() => build({ time: '8pm' })).toThrow(RangeError);
        expect(() => build({ time: '24:00' })).toThrow(RangeError);
    });

    describe('daylight saving time', () => {
        it('Europe/Berlin spring forward: keeps 02:30 on every day, including the skipped hour', () => {
            // 2026-03-29 01:00 UTC is when Berlin jumps from 02:00 to 03:00.
            const entries = build({ time: '02:30', timeZone: 'Europe/Berlin', now: new Date('2026-03-27T12:00:00Z') });
            expect(entries.map((e) => e.date)).toContain('2026-03-29');
            expect(entries.every((e) => e.time === '02:30' && e.timeZone === 'Europe/Berlin')).toBe(true);
        });

        it('Europe/Berlin spring forward: judges "already past" on the wall clock after the jump', () => {
            // 01:30 UTC is 03:30 CEST, after the jump: 02:30 today is behind us.
            expect(build({ time: '02:30', timeZone: 'Europe/Berlin', now: new Date('2026-03-29T01:30:00Z') })[0].date).toBe('2026-03-30');
            // 00:30 UTC is 01:30 CET, before it: 02:30 today is still ahead.
            expect(build({ time: '02:30', timeZone: 'Europe/Berlin', now: new Date('2026-03-29T00:30:00Z') })[0].date).toBe('2026-03-29');
        });

        it('Europe/Berlin fall back: keeps 02:30 across the repeated hour', () => {
            // 2026-10-25 01:00 UTC is when Berlin goes from 03:00 back to 02:00.
            const entries = build({ time: '02:30', timeZone: 'Europe/Berlin', now: new Date('2026-10-24T12:00:00Z') });
            expect(entries.filter((e) => e.date === '2026-10-25')).toHaveLength(1);
            expect(entries.every((e) => e.time === '02:30')).toBe(true);
            expect(entries).toHaveLength(14);
        });

        it('America/New_York spring forward and fall back keep 08:00 and never skip or repeat a day', () => {
            const spring = build({ time: '08:00', timeZone: 'America/New_York', now: new Date('2026-03-05T12:00:00Z') });
            const fall = build({ time: '08:00', timeZone: 'America/New_York', now: new Date('2026-10-30T12:00:00Z') });
            for (const entries of [spring, fall]) {
                expect(entries.every((e) => e.time === '08:00')).toBe(true);
                const days = entries.map((e) => Date.parse(`${e.date}T00:00:00Z`));
                days.slice(1).forEach((d, i) => expect(d - days[i]).toBe(86_400_000));
            }
            expect(spring.map((e) => e.date)).toContain('2026-03-08');
            expect(fall.map((e) => e.date)).toContain('2026-11-01');
        });
    });

    it('follows a time-zone change: the same instant is a different local day and time', () => {
        const now = new Date('2026-06-10T22:30:00Z');
        const ny = build({ time: '20:00', timeZone: 'America/New_York', now });
        const tokyo = build({ time: '20:00', timeZone: 'Asia/Tokyo', now });
        expect(ny[0].date).toBe('2026-06-10'); // 18:30 in New York
        expect(tokyo[0].date).toBe('2026-06-11'); // 07:30 the next day in Tokyo
        expect(ny.every((e) => e.timeZone === 'America/New_York')).toBe(true);
        expect(tokyo.every((e) => e.timeZone === 'Asia/Tokyo' && e.time === '20:00')).toBe(true);
    });
});

describe('localDateKey', () => {
    it('is the local calendar date in the zone', () => {
        const instant = new Date('2026-06-10T23:30:00Z');
        expect(localDateKey(instant, 'UTC')).toBe('2026-06-10');
        expect(localDateKey(instant, 'Asia/Tokyo')).toBe('2026-06-11');
        expect(localDateKey(instant, 'America/Los_Angeles')).toBe('2026-06-10');
    });
});
