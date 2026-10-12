import { describe, it, expect } from 'vitest';
import { liveBlockLayoutWarnings } from '../../mcp/tools/write';
import GUIDE from '../../mcp/AUTHORING.md?raw';

const block = (body: string, info = 'html id=d4sh') => '```' + info + '\n' + body + '\n```';

describe('liveBlockLayoutWarnings (#591)', () => {
    it.each([
        ['width: 800px', '<div style="width: 800px">x</div>'],
        ['min-width: 500px', '<div style="min-width:500px">x</div>'],
        ['w-[600px]', '<div className="w-[600px]">x</div>'],
        ['min-w-[420px]', '<div className="min-w-[420px]">x</div>'],
        ['width="800"', '<canvas width="800" height="200"></canvas>'],
        ['h-screen', '<div className="h-screen">x</div>'],
        ['min-h-screen', '<div className="min-h-screen">x</div>'],
        ['100vh', '<div style="height: 100vh">x</div>'],
    ])('flags %s and names the block', (_name, body) => {
        const [warning, ...rest] = liveBlockLayoutWarnings(block(body));
        expect(rest).toEqual([]);
        expect(warning).toContain('Block d4sh');
    });

    it('checks react and wide blocks too', () => {
        expect(liveBlockLayoutWarnings(block('<div className="w-[800px]" />', 'react wide id=r1x'))).toHaveLength(1);
    });

    it('ignores max-width, small widths and fluid values', () => {
        const body = '<div style="max-width: 800px; width: 360px; min-width: 200px; width: 100%">x</div><svg width="300"></svg>';
        expect(liveBlockLayoutWarnings(block(body))).toEqual([]);
    });

    it('ignores non-live fences and plain text', () => {
        expect(liveBlockLayoutWarnings(block('width: 800px', 'css'))).toEqual([]);
        expect(liveBlockLayoutWarnings(block('width: 800px', 'svg'))).toEqual([]);
        expect(liveBlockLayoutWarnings('width: 800px, h-screen')).toEqual([]);
    });

    it('gives one line per offending block', () => {
        const md = block('<b style="width: 900px"></b>', 'html id=aa11') + '\n\n' + block('<b class="h-screen"></b>', 'html id=bb22');
        const out = liveBlockLayoutWarnings(md);
        expect(out).toHaveLength(2);
        expect(out[0]).toContain('aa11');
        expect(out[1]).toContain('bb22');
    });

    it('warns on no example in the guide', () => {
        const examples = GUIDE.slice(GUIDE.indexOf('\n## Examples'));
        expect(examples).toContain('```');
        expect(liveBlockLayoutWarnings(examples)).toEqual([]);
    });
});
