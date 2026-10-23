// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { AVAILABLE_MODELS, getModelInfo, getModelsForJob } from '@/lib/webllm/models';
import { checkRequirements, probeDevice, resolveModelId, type DeviceProbe } from '@/lib/webllm/requirements';

const editor = getModelInfo('Qwen2.5-0.5B-Instruct-q4f16_1-MLC')!;
const agent = getModelInfo('Qwen3-1.7B-q4f16_1-MLC')!;

const GIB = 1024 ** 3;
const goodProbe: DeviceProbe = {
  isMobile: false,
  hasWebGPU: true,
  shaderF16: true,
  maxBufferSize: 4 * GIB,
  maxStorageBufferBindingSize: 2 * GIB,
  deviceMemoryGB: 8,
};

describe('checkRequirements', () => {
  it('accepts a capable desktop', () => {
    expect(checkRequirements(goodProbe, agent)).toEqual({ verdict: 'ok', modelId: agent.id, reasons: [] });
  });

  it('is unsupported without a WebGPU adapter', () => {
    const result = checkRequirements({ isMobile: false, hasWebGPU: false }, editor);
    expect(result.verdict).toBe('unsupported');
    expect(result.reasons.join(' ')).toMatch(/needs WebGPU/);
  });

  it('is always unsupported on mobile', () => {
    expect(checkRequirements({ ...goodProbe, isMobile: true }, editor).verdict).toBe('unsupported');
  });

  it('uses the f32 twin when the GPU has no shader-f16', () => {
    const result = checkRequirements({ ...goodProbe, shaderF16: false }, editor);
    expect(result).toEqual({ verdict: 'ok', modelId: editor.f32Id, reasons: [] });
  });

  it('is unsupported without shader-f16 when the model has no f32 twin', () => {
    const { f32Id: _unused, ...noTwin } = editor;
    void _unused;
    expect(checkRequirements({ ...goodProbe, shaderF16: false }, noTwin).verdict).toBe('unsupported');
  });

  it('warns when an agent model meets low device memory', () => {
    const result = checkRequirements({ ...goodProbe, deviceMemoryGB: 2 }, agent);
    expect(result.verdict).toBe('warn');
    expect(result.reasons).toHaveLength(1);
  });

  it('does not warn editor models about low device memory', () => {
    expect(checkRequirements({ ...goodProbe, deviceMemoryGB: 2 }, editor).verdict).toBe('ok');
  });

  it('makes no memory claim when deviceMemory is unknown', () => {
    const { deviceMemoryGB: _unused, ...unknownMemory } = goodProbe;
    void _unused;
    expect(checkRequirements(unknownMemory, agent)).toEqual({ verdict: 'ok', modelId: agent.id, reasons: [] });
  });

  it('warns when the GPU limits buffer size', () => {
    expect(checkRequirements({ ...goodProbe, maxStorageBufferBindingSize: GIB / 8 }, editor).verdict).toBe('warn');
    expect(checkRequirements({ ...goodProbe, maxBufferSize: GIB / 2 }, editor).verdict).toBe('warn');
  });
});

describe('probeDevice', () => {
  const nav = navigator as unknown as { gpu?: unknown; deviceMemory?: number };
  afterEach(() => {
    delete nav.gpu;
    delete nav.deviceMemory;
  });

  it('reports no WebGPU when navigator.gpu is missing', async () => {
    expect(await probeDevice(false)).toMatchObject({ isMobile: false, hasWebGPU: false });
  });

  it('reports no WebGPU when no adapter is available or the request throws', async () => {
    nav.gpu = { requestAdapter: async () => null };
    expect((await probeDevice(false)).hasWebGPU).toBe(false);
    nav.gpu = { requestAdapter: async () => { throw new Error('blocked'); } };
    expect((await probeDevice(false)).hasWebGPU).toBe(false);
  });

  it('reads features, limits and device memory from the adapter', async () => {
    nav.deviceMemory = 8;
    nav.gpu = {
      requestAdapter: async () => ({
        features: new Set(['timestamp-query']),
        limits: { maxBufferSize: 123, maxStorageBufferBindingSize: 45 },
      }),
    };
    // The probe asks the adapter with `has`, which Set provides.
    expect(await probeDevice(true)).toEqual({
      isMobile: true,
      hasWebGPU: true,
      shaderF16: false,
      maxBufferSize: 123,
      maxStorageBufferBindingSize: 45,
      deviceMemoryGB: 8,
    });
  });

  it('resolveModelId swaps in the f32 twin when the adapter lacks shader-f16', async () => {
    nav.gpu = { requestAdapter: async () => ({ features: new Set(), limits: {} }) };
    expect(await resolveModelId(editor.id)).toBe(editor.f32Id);
    expect(await resolveModelId('unlisted-model')).toBe('unlisted-model');
  });
});

describe('model catalogue', () => {
  const byId = new Map(prebuiltAppConfig.model_list.map((m) => [m.model_id, m]));

  it('lists every id, and every f32Id, in web-llm prebuiltAppConfig', () => {
    for (const model of AVAILABLE_MODELS) {
      expect(byId.has(model.id), model.id).toBe(true);
      if (model.f32Id) expect(byId.has(model.f32Id), model.f32Id).toBe(true);
    }
  });

  it('matches vramMB to vram_required_MB', () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.vramMB, model.id).toBe(byId.get(model.id)!.vram_required_MB);
    }
  });

  it('has one default for each job', () => {
    for (const job of ['editor', 'agent'] as const) {
      expect(getModelsForJob(job).filter((m) => m.recommended), job).toHaveLength(1);
    }
  });
});
