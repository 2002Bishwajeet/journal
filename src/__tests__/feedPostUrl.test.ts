import { describe, it, expect } from 'vitest';
import { feedPostUrl } from '@/lib/share/feedArticle';

describe('feedPostUrl', () => {
    it('builds the post page on the identity from the public channel and the post id', () => {
        expect(feedPostUrl('alice.dotyou.cloud', 'abc-123')).toBe('https://alice.dotyou.cloud/posts/public-posts/abc-123');
    });
});
