// @vitest-environment happy-dom
/**
 * On-device AI in the iOS app (#1143): the device gate with `navigator.gpu` mocked, the
 * cellular notice before a download, and the marker that stops a model which crashed the
 * page from loading again. The web and desktop gates stay as they were.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  checkIOSRequirements,
  crashedModels,
  iosCanRunAI,
  mayBeCellular,
  NOT_ON_THIS_DEVICE,
  probeIOS,
  setRunningModel,
  takeCrashedModel,
  TOO_LARGE_MESSAGE,
  type IOSProbe,
} from '@/lib/webllm/ios';
import { getLastLoadError, initWebLLM } from '@/lib/webllm/engine';
import { getModelInfo, getModelsForJob, AVAILABLE_MODELS } from '@/lib/webllm/models';
import { aiSupportedOn } from '@/hooks/useAISupported';
import { sectionsFor } from '@/components/settings/sections';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const MiB = 1024 ** 2;
const GB8 = 7.9e9; // what an 8 GB iPhone reports
const GB6 = 5.9e9;

function setIOS(plugins: string[] = ['premium']) {
  window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins };
}

function mockGPU(limits: { maxBufferSize: number; maxStorageBufferBindingSize: number } | null) {
  const adapter = limits && { features: { has: () => true }, limits };
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => adapter } });
}

const capableLimits = { maxBufferSize: 1024 * MiB, maxStorageBufferBindingSize: 1024 * MiB };

afterEach(() => {
  setIOS();
  setRunningModel(null);
  window.__JOURNAL_NATIVE__ = undefined;
  Reflect.deleteProperty(navigator, 'gpu');
  localStorage.clear();
  setVisibility('visible');
  invoke.mockReset();
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('the iOS device gate', () => {
  async function gate(gpu: Parameters<typeof mockGPU>[0], memory: number | null, plugins?: string[]) {
    setIOS(plugins);
    mockGPU(gpu);
    invoke.mockResolvedValue(memory);
    return iosCanRunAI(await probeIOS());
  }

  it('hides AI without navigator.gpu', async () => {
    setIOS();
    invoke.mockResolvedValue(GB8);
    expect(iosCanRunAI(await probeIOS())).toBe(false);
  });

  it('hides AI when WebGPU gives no adapter', async () => {
    expect(await gate(null, GB8)).toBe(false);
  });

  it('hides AI when the buffer limits are below what web-llm needs', async () => {
    expect(await gate({ maxBufferSize: 128 * MiB, maxStorageBufferBindingSize: 1024 * MiB }, GB8)).toBe(false);
    expect(await gate({ maxBufferSize: 1024 * MiB, maxStorageBufferBindingSize: 64 * MiB }, GB8)).toBe(false);
  });

  it('hides AI on a 6 GB device', async () => {
    expect(await gate(capableLimits, GB6)).toBe(false);
  });

  it('hides AI in the Simulator, where the app reports no memory', async () => {
    expect(await gate(capableLimits, null)).toBe(false);
  });

  it('hides AI without the premium plugin, and asks it nothing', async () => {
    expect(await gate(capableLimits, GB8, [])).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows AI on an 8 GB device with WebGPU', async () => {
    expect(await gate(capableLimits, GB8)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('plugin:premium|device_memory', undefined);
  });

  it('keeps the web and desktop gates on the screen size', () => {
    expect(aiSupportedOn('mobile')).toBe(false);
    expect(aiSupportedOn('tablet')).toBe(true);
    expect(aiSupportedOn('desktop')).toBe(true);
    window.__JOURNAL_NATIVE__ = { platform: 'macos' };
    expect(aiSupportedOn('desktop')).toBe(true);
  });

  it('hides AI in the iOS app until the device passed the check, whatever the screen', () => {
    setIOS();
    expect(aiSupportedOn('desktop')).toBe(false);
  });

  it('lists the AI settings on the phone app only where it runs', () => {
    expect(sectionsFor('native-phone').map((s) => s.id)).not.toContain('ai');
    expect(sectionsFor('native-phone', false, true).map((s) => s.id)).toContain('ai');
    expect(sectionsFor('web-phone', false, true).map((s) => s.id)).not.toContain('ai');
  });
});

describe('the iOS download gate', () => {
  const capable: IOSProbe = {
    gpu: { isMobile: false, hasWebGPU: true, shaderF16: true, ...capableLimits },
    memoryBytes: GB8,
  };
  const wifi = { type: 'wifi' };
  const agent = getModelInfo('Qwen3.5-2B-q4f16_1-MLC')!;

  it('offers the small models and hides the larger ones', () => {
    const offered = AVAILABLE_MODELS.filter((m) => checkIOSRequirements(capable, m, [], wifi).verdict === 'ok').map((m) => m.name);
    expect(offered).toEqual(['SmolLM2 360M', 'Qwen 2.5 0.5B', 'Qwen 2.5 1.5B', 'Qwen3.5 2B', 'Qwen3 1.7B']);
    expect(getModelsForJob('agent').some((m) => checkIOSRequirements(capable, m, [], wifi).verdict === 'unsupported')).toBe(true);
  });

  it('refuses every model on a device that failed the check', () => {
    expect(checkIOSRequirements({ ...capable, memoryBytes: GB6 }, agent, [], wifi)).toMatchObject({
      verdict: 'unsupported',
      reasons: [NOT_ON_THIS_DEVICE],
    });
  });

  it('refuses a model that crashed the page', () => {
    expect(checkIOSRequirements(capable, agent, [agent.id], wifi)).toMatchObject({ verdict: 'unsupported', reasons: [TOO_LARGE_MESSAGE] });
  });

  it('says the download may use cellular data, unless the connection is known to be something else', () => {
    expect(mayBeCellular(undefined)).toBe(true);
    expect(mayBeCellular({})).toBe(true);
    expect(mayBeCellular({ type: 'cellular' })).toBe(true);
    expect(mayBeCellular({ type: 'wifi' })).toBe(false);

    const onCellular = checkIOSRequirements(capable, agent, [], { type: 'cellular' });
    expect(onCellular.verdict).toBe('warn');
    expect(onCellular.reasons.join(' ')).toMatch(/cellular data/);
    expect(checkIOSRequirements(capable, agent, [], undefined).reasons.join(' ')).toMatch(/cellular data/);
    expect(checkIOSRequirements(capable, agent, [], wifi)).toMatchObject({ verdict: 'ok', reasons: [] });
  });
});

describe('the crash marker', () => {
  const id = 'Qwen3.5-2B-q4f16_1-MLC';

  it('marks the model that was in memory when the page died, once, and it never loads again', async () => {
    setIOS();
    setRunningModel(id);
    // WebKit kills the page here: nothing clears the marker. The next launch:
    expect(takeCrashedModel()).toBe(id);
    expect(takeCrashedModel()).toBeNull();
    expect(crashedModels()).toEqual([id]);

    expect(await initWebLLM(undefined, id)).toBe(false);
    expect((getLastLoadError() as Error).message).toBe(TOO_LARGE_MESSAGE);
  });

  it('marks nothing after the model unloaded or failed', () => {
    setIOS();
    setRunningModel(id);
    setRunningModel(null);
    expect(takeCrashedModel()).toBeNull();
    expect(crashedModels()).toEqual([]);
  });

  it('marks nothing when iOS kills the page in the background', () => {
    setIOS();
    setRunningModel(id);
    setVisibility('hidden');
    expect(takeCrashedModel()).toBeNull();
    setVisibility('visible');
    expect(takeCrashedModel()).toBe(id);
  });

  it('marks nothing when the page reloads in the foreground', () => {
    setIOS();
    setRunningModel(id);
    // An app update, an error retry or a bfcache reload: location.reload() fires pagehide while visible.
    window.dispatchEvent(new Event('pagehide'));
    expect(takeCrashedModel()).toBeNull();
    expect(crashedModels()).toEqual([]);
  });

  it('does nothing outside the iOS app', () => {
    setRunningModel(id);
    expect(takeCrashedModel()).toBeNull();
    window.__JOURNAL_NATIVE__ = { platform: 'macos' };
    setRunningModel(id);
    expect(takeCrashedModel()).toBeNull();
  });
});
