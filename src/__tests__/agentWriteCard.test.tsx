/** The card for a write the assistant proposes (#702), and its public notice (#949). */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentWriteCard } from '@/components/layout/AgentWriteCard';
import type { AgentStep } from '@/hooks/useAgentSession';
import { setCanEdit } from '@/hooks/useCanEdit';

const pendingWrite = vi.hoisted(() => ({ pending: null as object | null }));
vi.mock('@/hooks/usePendingWrite', () => ({
    usePendingWrite: () => ({ pending: pendingWrite.pending, accept: () => {}, reject: () => {} }),
}));

const card = (write: NonNullable<AgentStep['write']>) =>
    renderToStaticMarkup(<AgentWriteCard step={{ before: '', after: '', summary: "Create note 'Ideas' in Shared", write }} />);

describe('AgentWriteCard', () => {
    it('should say the write will be public while it waits on a shared target', () => {
        expect(card({ markdown: 'first idea', isPublic: true, state: 'pending' })).toContain('Will be public');
    });

    it('should not say so for a private target', () => {
        expect(card({ markdown: 'first idea', isPublic: false, state: 'pending' })).not.toContain('Will be public');
        expect(card({ markdown: 'first idea', state: 'pending' })).not.toContain('Will be public');
    });

    it('should drop the notice once the user has answered', () => {
        expect(card({ markdown: 'first idea', isPublic: true, state: 'rejected' })).not.toContain('Will be public');
    });

    it('read-only (#1176): a pending write can be rejected but not accepted', () => {
        pendingWrite.pending = {};
        setCanEdit(false);
        const html = card({ markdown: 'first idea', state: 'pending' });
        setCanEdit(true);
        pendingWrite.pending = null;
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Accept<\/button>/);
        expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/);
    });
});
