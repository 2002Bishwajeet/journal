// @vitest-environment happy-dom
/**
 * Characterization tests for the AI orchestration logic moved out of
 * SettingsModal's inline JSX handlers into useAIPreferences (#208) and the
 * cache-deletion logic moved into clearModelCache (src/lib/webllm/engine.ts).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAIPreferences, type UseAIPreferencesReturn } from '@/hooks/useAIPreferences';
import { STORAGE_KEY } from '@/hooks/useAISettings';
import { clearModelCache } from '@/lib/webllm/engine';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function mountRoot() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    return {
        root,
        cleanup: async () => {
            await act(async () => root.unmount());
            el.remove();
        },
    };
}

/** Mounts useAIPreferences and hands back a getter for its latest return value. */
function renderAIPreferences() {
    let latest: UseAIPreferencesReturn | undefined;
    function Harness() {
        latest = useAIPreferences();
        return null;
    }
    const { root, cleanup } = mountRoot();
    return {
        get: () => latest!,
        mount: () => act(async () => { root.render(h(Harness)); }),
        cleanup,
    };
}

describe('useAIPreferences', () => {
    beforeEach(() => {
        localStorage.clear();
        // Force "mobile" so initialize()/switchModel() short-circuit inside
        // useWebLLM instead of dynamically importing the real WebLLM module.
        window.innerWidth = 500;
    });

    it('setEnabled(true) persists enabled: true under journal-ai-settings', async () => {
        const harness = renderAIPreferences();
        await harness.mount();

        await act(async () => { harness.get().setEnabled(true); });

        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(stored.enabled).toBe(true);

        await harness.cleanup();
    });

    it('selectModel(id) persists the new modelId', async () => {
        const harness = renderAIPreferences();
        await harness.mount();

        await act(async () => { await harness.get().selectModel('some-other-model-id'); });

        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(stored.modelId).toBe('some-other-model-id');

        await harness.cleanup();
    });
});

describe('clearModelCache', () => {
    it('deletes only caches whose name contains webllm or mlc', async () => {
        const deletedCaches: string[] = [];
        (globalThis as unknown as { caches: { keys: () => Promise<string[]>; delete: (name: string) => Promise<boolean> } }).caches = {
            keys: async () => ['webllm-model-cache', 'mlc-shards', 'some-other-cache'],
            delete: async (name: string) => {
                deletedCaches.push(name);
                return true;
            },
        };

        const removedEntries: string[] = [];
        const entries: [string, unknown][] = [
            ['mlc-model-a', {}],
            ['webllm-shard', {}],
            ['unrelated-dir', {}],
        ];
        Object.defineProperty(navigator, 'storage', {
            value: {
                getDirectory: async () => ({
                    entries: async function* () {
                        for (const entry of entries) yield entry;
                    },
                    removeEntry: async (name: string) => {
                        removedEntries.push(name);
                    },
                }),
            },
            configurable: true,
        });

        await clearModelCache();

        expect(deletedCaches).toEqual(['webllm-model-cache', 'mlc-shards']);
        expect(removedEntries).toEqual(['mlc-model-a', 'webllm-shard']);
    });
});
