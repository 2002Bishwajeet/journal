// @vitest-environment happy-dom
/**
 * Before the grants file has loaded, useAgentGrants' grants are EMPTY_GRANTS with no
 * fileId. A change made then would create a second grants file (the drive rejects it:
 * existingFileWithUniqueId) built from empty grants, dropping every existing one — so
 * the Agent access screen must not offer any control until the load finishes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EMPTY_GRANTS } from '@/lib/agent/grants';

const mocks = vi.hoisted(() => ({
    load: vi.fn(),
}));

vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));
vi.mock('@/lib/homebase/AgentGrantsDriveProvider', () => ({
    AgentGrantsDriveProvider: class {
        load = mocks.load;
    },
}));
vi.mock('@/hooks/useFolders', () => ({
    useFolders: () => ({ get: { data: [{ id: 'F1', name: 'Folder One' }] } }),
}));
vi.mock('@/hooks/useNotes', () => ({ useNotesByFolder: () => ({ data: [] }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import AgentAccessSection from '@/components/settings/sections/AgentAccessSection';

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
});

const folderSelect = () => document.querySelector('select[aria-label="Agent access for Folder One"]');

describe('AgentAccessSection — before the grants file has loaded', () => {
    it('offers no access control until the load resolves', async () => {
        let resolveLoad!: (value: unknown) => void;
        mocks.load.mockReturnValue(new Promise((resolve) => (resolveLoad = resolve)));

        const el = document.createElement('div');
        document.body.appendChild(el);
        const root = createRoot(el);
        const queryClient = new QueryClient();
        await act(async () => {
            root.render(h(QueryClientProvider, { client: queryClient }, h(AgentAccessSection)));
        });

        expect(folderSelect()).toBeNull();

        resolveLoad({ grants: EMPTY_GRANTS, versionTag: 'v1', fileId: 'file-1' });
        // React Query notifies on a later macrotask, and under load one tick isn't enough:
        // keep flushing inside act until the control appears.
        await vi.waitFor(async () => {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
            expect(folderSelect()).not.toBeNull();
        });
        await act(async () => root.unmount());
    });
});
