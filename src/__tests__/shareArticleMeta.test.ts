/**
 * Article metadata shown in the public share page byline (#221): word count for
 * reading time, the published/updated date labels, and when "Updated" appears.
 */
import { describe, it, expect } from 'vitest';
import { countWords, formatShareDate, showUpdated } from '@/lib/share/articleMeta';

describe('countWords', () => {
    it('counts prose words, ignoring code blocks, images, link URLs and markdown punctuation', () => {
        const md = 'Hello **world**\n\n```js\nconst a = 1\n```\n![x](y.png) [link](https://a.b)';
        expect(countWords(md)).toBe(3);
    });

    it('ignores math, inline code markers, headings and list markers', () => {
        const md = '# Title\n\n- one `two`\n- three $E=mc^2$\n\n$$\nx^2\n$$';
        expect(countWords(md)).toBe(4);
    });

    it('returns 0 for empty markdown', () => {
        expect(countWords('')).toBe(0);
    });
});

describe('showUpdated', () => {
    it('is false when the note was updated within a day of publishing', () => {
        expect(showUpdated('2026-01-02T00:00:00Z', '2026-01-02T01:00:00Z')).toBe(false);
    });

    it('is true when the note was updated days after publishing', () => {
        expect(showUpdated('2026-01-02T00:00:00Z', '2026-01-04T00:00:00Z')).toBe(true);
    });
});

describe('formatShareDate', () => {
    it('formats an ISO date as a long, human-readable date', () => {
        expect(formatShareDate('2026-01-02T00:00:00Z', 'en-US')).toContain('2026');
    });
});
