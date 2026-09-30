// @vitest-environment happy-dom
/**
 * Characterization tests for the AI orchestration logic moved out of
 * SettingsModal's inline JSX handlers into useAIPreferences (#208) and the
 * cache-deletion logic moved into clearModelCache (src/lib/webllm/engine.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { useAIPreferences, type UseAIPreferencesReturn } from '@/hooks/useAIPreferences';
import { STORAGE_KEY, DEFAULT_SETTINGS } from '@/hooks/useAISettings';
import { clearModelCache } from '@/lib/webllm/engine';
import * as webllm from '@/lib/webllm';

// Stub the WebLLM engine boundary: the real one downloads a model into a worker.
const engine = vi.hoisted(() => ({ ready: false }));
vi.mock('@/lib/webllm', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/webllm')>()),
    isWebLLMReady: vi.fn(() => engine.ready),
    isWebLLMLoading: vi.fn(() => false),
    initWebLLM: vi.fn(async () => { engine.ready = true; return true; }),
    unloadWebLLM: vi.fn(async () => { engine.ready = false; }),
    clearModelCache: vi.fn(async () => { engine.ready = false; }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

    it('reports AI as unsupported on a phone-width screen', async () => {
        const harness = renderAIPreferences();
        await harness.mount();

        expect(harness.get().isSupported).toBe(false);

        await harness.cleanup();
    });
});

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const storedSettings = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!);

describe('useAIPreferences on a supported (desktop) screen', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, enabled: true }));
        window.innerWidth = 1280;
        engine.ready = false;
        vi.clearAllMocks();
    });

    /** Mounts with AI enabled and waits for the auto-init to load the model. */
    async function mountReady() {
        const harness = renderAIPreferences();
        await harness.mount();
        await wait(600);
        expect(harness.get().isReady).toBe(true);
        return harness;
    }

    it('setEnabled(false) unloads the loaded model', async () => {
        const harness = await mountReady();

        await act(async () => { await harness.get().setEnabled(false); });

        expect(webllm.unloadWebLLM).toHaveBeenCalled();
        expect(storedSettings().enabled).toBe(false);

        await harness.cleanup();
    });

    it('turning AI back on after turning it off loads the model again', async () => {
        const harness = await mountReady();

        await act(async () => { await harness.get().setEnabled(false); });
        await act(async () => { await harness.get().setEnabled(true); });
        await wait(0);

        expect(webllm.initWebLLM).toHaveBeenCalledTimes(2);
        expect(engine.ready).toBe(true);

        await harness.cleanup();
    });

    it('a failed model switch restores the previous modelId and says so', async () => {
        const harness = await mountReady();
        vi.mocked(webllm.initWebLLM).mockResolvedValueOnce(false);

        await act(async () => { await harness.get().selectModel('SmolLM2-360M-Instruct-q4f16_1-MLC'); });

        expect(storedSettings().modelId).toBe(DEFAULT_SETTINGS.modelId);
        expect(toast.error).toHaveBeenCalledWith("Couldn't switch to SmolLM2 360M. Kept Qwen 2.5 1.5B.");

        await harness.cleanup();
    });

    it('surfaces a load failure as an error that a retry clears', async () => {
        vi.mocked(webllm.initWebLLM).mockResolvedValueOnce(false);
        const harness = renderAIPreferences();
        await harness.mount();
        await wait(600);

        expect(harness.get().isReady).toBe(false);
        expect(harness.get().error).toBe("Couldn't load the AI model.");

        await act(async () => { await harness.get().initialize(); });

        expect(harness.get().error).toBeNull();
        expect(harness.get().isReady).toBe(true);

        await harness.cleanup();
    });

    it('clearCache turns AI off, removes the model files and does not reload the page', async () => {
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        const harness = await mountReady();

        await act(async () => { await harness.get().clearCache(); });

        expect(storedSettings().enabled).toBe(false);
        expect(webllm.clearModelCache).toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith("Model files removed. They'll download again next time AI loads.");

        reload.mockRestore();
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
