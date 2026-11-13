// @vitest-environment happy-dom
/**
 * Apple's on-device model (#1266): the native plugin `journal-apple-ai` runs the editor jobs on
 * Apple Intelligence devices. Its availability check, the web-llm-shaped engine over `generate`,
 * loading it in `initWebLLM` with nothing to download, the once-per-device default, and its row
 * in Settings → AI. The assistant keeps its WebLLM model.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { appleEngine, checkAppleModel, isAppleModelAvailable } from '@/lib/webllm/apple';
import { checkGrammar, getAutocompleteSuggestion, getLastLoadError, initWebLLM, isModelCached, isWebLLMReady, rewriteText, unloadWebLLM } from '@/lib/webllm/engine';
import { APPLE_MODEL, APPLE_MODEL_ID, AVAILABLE_MODELS, DEFAULT_MODEL_ID, getModelInfo } from '@/lib/webllm/models';
import { adoptAppleModel, DEFAULT_SETTINGS, loadSettings, STORAGE_KEY } from '@/hooks/useAISettings';
import { AI_APPLE_DEFAULT_KEY } from '@/lib/storage';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const prefs = vi.hoisted(() => ({ modelId: '' }));
vi.mock('@/hooks/useAIPreferences', () => ({
    useAIPreferences: () => ({
        settings: { ...DEFAULT_SETTINGS, enabled: true, modelId: prefs.modelId },
        isReady: true,
        isLoading: false,
        loadingProgress: 0,
        loadingMessage: '',
        error: null,
        isSupported: true,
        downloadDialogProps: { pending: null, onContinue: () => {}, onCancel: () => {} },
    }),
}));

const { default: AISection } = await import('@/components/settings/sections/AISection');

const PLUGIN = 'journal-apple-ai';

function setIOS(plugins: string[] = [PLUGIN]) {
    window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins };
}

/** The plugin answers `available` with `available`, and `generate` with `text`. */
function mockPlugin(available: boolean, text = '') {
    invoke.mockImplementation(async (cmd: string) => {
        if (cmd === `plugin:${PLUGIN}|available`) return { available };
        if (cmd === `plugin:${PLUGIN}|generate`) return { text };
        throw new Error(`unexpected ${cmd}`);
    });
}

const generateCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === `plugin:${PLUGIN}|generate`).map(([, args]) => args);

afterEach(async () => {
    await unloadWebLLM();
    window.__JOURNAL_NATIVE__ = undefined;
    await checkAppleModel();
    localStorage.clear();
    invoke.mockReset();
});

describe('the availability check', () => {
    it('is false on the web and without the plugin, and asks nothing', async () => {
        expect(await checkAppleModel()).toBe(false);
        setIOS(['premium']);
        expect(await checkAppleModel()).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('follows what the plugin says', async () => {
        setIOS();
        mockPlugin(true);
        expect(await checkAppleModel()).toBe(true);
        expect(isAppleModelAvailable()).toBe(true);
        mockPlugin(false);
        expect(await checkAppleModel()).toBe(false);
        expect(isAppleModelAvailable()).toBe(false);
    });

    it('is false when the plugin fails', async () => {
        setIOS();
        invoke.mockRejectedValue(new Error('boom'));
        expect(await checkAppleModel()).toBe(false);
    });
});

describe('the engine over generate', () => {
    it('sends the system message as the instructions and the user message as the prompt', async () => {
        setIOS();
        mockPlugin(true, 'Hello there');
        const response = await appleEngine.chat.completions.create({
            messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }],
            max_tokens: 30,
            temperature: 0.3,
        });
        expect(response.choices[0].message.content).toBe('Hello there');
        expect(generateCalls()).toEqual([{ instructions: 'Be brief.', prompt: 'Hi', maxTokens: 30, temperature: 0.3, schema: undefined }]);
    });

    it('puts a conversation in the prompt with who said what', async () => {
        setIOS();
        mockPlugin(true, 'ok');
        await appleEngine.chat.completions.create({
            messages: [{ role: 'user', content: 'One' }, { role: 'assistant', content: 'Two' }, { role: 'user', content: 'Three' }],
        });
        expect(generateCalls()[0]).toMatchObject({ instructions: undefined, prompt: 'User: One\n\nAssistant: Two\n\nUser: Three' });
    });

    it('passes a schema on for guided generation', async () => {
        setIOS();
        mockPlugin(true, '{}');
        await appleEngine.chat.completions.create({ messages: [{ role: 'user', content: 'x' }], response_format: { schema: '{"type":"object"}' } });
        expect(generateCalls()[0]).toMatchObject({ schema: '{"type":"object"}' });
    });
});

describe('loading it as the writing-help model', () => {
    it('is in the catalogue lookup, but not in the WebLLM list', () => {
        expect(getModelInfo(APPLE_MODEL_ID)).toBe(APPLE_MODEL);
        expect(APPLE_MODEL.job).toBe('editor');
        expect(AVAILABLE_MODELS.map((m) => m.id)).not.toContain(APPLE_MODEL_ID);
    });

    it('has nothing to download', async () => {
        expect(await isModelCached(APPLE_MODEL_ID)).toBe(true);
    });

    it('loads without web-llm and runs autocomplete, grammar and rewrite through the plugin', async () => {
        setIOS();
        mockPlugin(true, 'the next words');
        expect(await initWebLLM(undefined, APPLE_MODEL_ID)).toBe(true);
        expect(isWebLLMReady()).toBe(true);
        expect(await getAutocompleteSuggestion('I went to')).toBe('the next words');
        expect(await rewriteText('Some text', 'concise')).toBe('the next words');

        invoke.mockClear();
        mockPlugin(true, '{"errors":["Use \\"an\\" before a vowel."]}');
        expect(await checkGrammar('This is a apple.')).toEqual(['Use "an" before a vowel.']);
        const grammar = generateCalls()[0] as { schema: string };
        expect(JSON.parse(grammar.schema)).toEqual({
            type: 'object',
            properties: { errors: { type: 'array', items: { type: 'string' }, maxItems: 5 } },
            required: ['errors'],
        });
        // Nothing is marked as a model in the web view's memory.
        expect(localStorage.getItem('journal-ai-running-model')).toBeNull();
    });

    it('fails to load where it cannot run', async () => {
        setIOS();
        mockPlugin(false);
        expect(await initWebLLM(undefined, APPLE_MODEL_ID)).toBe(false);
        expect(isWebLLMReady()).toBe(false);
        expect(String(getLastLoadError())).toContain("Apple's on-device model is not available");
    });
});

describe('the default on supported devices', () => {
    it('becomes the writing-help model where nothing was chosen, and tells the hooks', () => {
        const events: (string | null)[] = [];
        const listener = (e: StorageEvent) => events.push(e.key);
        window.addEventListener('storage', listener);
        adoptAppleModel();
        window.removeEventListener('storage', listener);
        expect(loadSettings().modelId).toBe(APPLE_MODEL_ID);
        expect(events).toEqual([STORAGE_KEY]);
    });

    it('replaces the WebLLM default, but keeps the other settings', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, enabled: true, grammarEnabled: true, _v: 2 }));
        adoptAppleModel();
        expect(loadSettings()).toMatchObject({ enabled: true, grammarEnabled: true, modelId: APPLE_MODEL_ID });
    });

    it('keeps a model the user picked', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC', _v: 2 }));
        adoptAppleModel();
        expect(loadSettings().modelId).toBe('SmolLM2-360M-Instruct-q4f16_1-MLC');
    });

    it('happens once per device: picking the WebLLM default later stays', () => {
        adoptAppleModel();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), modelId: DEFAULT_MODEL_ID, _v: 2 }));
        adoptAppleModel();
        expect(loadSettings().modelId).toBe(DEFAULT_MODEL_ID);
        expect(localStorage.getItem(AI_APPLE_DEFAULT_KEY)).toBe('1');
    });
});

describe('Settings → AI', () => {
    it('lists it first under writing help where it can run, and not for the assistant', async () => {
        setIOS();
        mockPlugin(true);
        await checkAppleModel();
        prefs.modelId = APPLE_MODEL_ID;
        const html = renderToStaticMarkup(<AISection />);
        expect(html).toMatch(/Ready · (<!-- -->)?Apple on-device model/);
        const writing = html.slice(html.indexOf('aria-label="Writing help"'), html.indexOf('aria-label="Assistant"'));
        expect(writing.indexOf('Apple on-device model')).toBeLessThan(writing.indexOf('SmolLM2 360M'));
        expect(writing).toContain('No download');
        expect(writing).toContain(`checked="" value="${APPLE_MODEL_ID}"`);
        expect(html.slice(html.indexOf('aria-label="Assistant"'))).not.toContain('Apple on-device model');
    });

    it('is not offered where it cannot run', () => {
        prefs.modelId = DEFAULT_MODEL_ID;
        expect(renderToStaticMarkup(<AISection />)).not.toContain('Apple on-device model');
    });
});
