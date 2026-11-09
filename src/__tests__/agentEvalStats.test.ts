import { describe, expect, it } from 'vitest';
import { machineTag, percentile, speedOf, type Turn } from '../../e2e/evals/stats';

// The AI eval's speed figures (#1022).

const turn = (prefillTokensPerS: number, decodeTokensPerS: number, promptTokens = 1000): Turn => ({
    promptTokens,
    completionTokens: 40,
    prefillTokensPerS,
    decodeTokensPerS,
});

describe('percentile', () => {
    it('takes the middle value, or between the two middle ones', () => {
        expect(percentile([3, 1, 2], 50)).toBe(2);
        expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
    });

    it('interpolates p90, and gives the one value or null at the edges', () => {
        expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(91);
        expect(percentile([7], 90)).toBe(7);
        expect(percentile([], 50)).toBeNull();
    });
});

describe('speedOf', () => {
    it('gives median tok/s over every turn, average prompt tokens per turn, and p50/p90 task time', () => {
        const speed = speedOf([
            { wallMs: 10_000, turns: [turn(100, 10, 800), turn(300, 30, 1200)] },
            { wallMs: 30_000, turns: [turn(200, 20, 1000)] },
            { wallMs: 20_000, turns: [] },
        ]);
        expect(speed).toEqual({ prefillTokensPerS: 200, decodeTokensPerS: 20, promptTokensPerTurn: 1000, p50Ms: 20_000, p90Ms: 28_000 });
    });

    it('has no speed for a model that never finished a turn', () => {
        expect(speedOf([{ wallMs: 5_000, turns: [] }])).toMatchObject({ prefillTokensPerS: null, decodeTokensPerS: null, promptTokensPerTurn: null });
    });
});

describe('machineTag (#1023)', () => {
    const apple = { vendor: 'apple', architecture: 'metal-3', shaderF16: true };

    it('joins the adapter and the host name\'s first label', () => {
        expect(machineTag(apple, 'Bishwajeets-MacBook-Pro.local')).toBe('apple-metal-3-bishwajeets-macbook-pro');
        expect(machineTag({ vendor: 'amd', architecture: 'gcn-5', shaderF16: true }, 'CachyOs-G14')).toBe('amd-gcn-5-cachyos-g14');
    });

    it('uses only the host without an adapter', () => {
        expect(machineTag(null, 'CachyOs-G14')).toBe('cachyos-g14');
    });

    it('prefers EVAL_MACHINE', () => {
        expect(machineTag(apple, 'anything', 'M1 Pro')).toBe('m1-pro');
    });
});
