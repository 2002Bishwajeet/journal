import { getModelInfo, getModelsForJob, type ModelInfo } from './models';

export interface DeviceProbe {
  isMobile: boolean;
  /** `navigator.gpu` gave us an adapter. */
  hasWebGPU: boolean;
  /** `undefined` when there is no adapter to ask. */
  shaderF16?: boolean;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
  /** GB. Chrome only, and capped at 8, so only a value under 8 means anything. */
  deviceMemoryGB?: number;
}

export interface RequirementsResult {
  verdict: 'ok' | 'warn' | 'unsupported';
  /** The id to load: the model's `f32Id` when the GPU has no `shader-f16`. */
  modelId: string;
  /** Why the device is unsupported, or what to be careful about. */
  reasons: string[];
}

// Conservative floor. Desktop adapters report 2 GiB or more per buffer.
const MIN_BUFFER_BYTES = 1024 ** 3;
// Browsers cap deviceMemory at 8, so 8 says nothing; under 8 is too little for any assistant model (#1023).
const MIN_AGENT_MEMORY_GB = 8;

interface GpuAdapterLike {
  features: { has(name: string): boolean };
  limits: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
}

export async function probeDevice(isMobile: boolean): Promise<DeviceProbe> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: { requestAdapter(options?: { powerPreference: 'high-performance' }): Promise<GpuAdapterLike | null> };
  };
  let adapter: GpuAdapterLike | null = null;
  try {
    // The adapter web-llm loads on: on a laptop with two GPUs, the default can be the other one (#1023).
    adapter = (await nav.gpu?.requestAdapter({ powerPreference: 'high-performance' })) ?? null;
  } catch {
    // A blocked or broken adapter counts as no adapter.
  }
  if (!adapter) return { isMobile, hasWebGPU: false, deviceMemoryGB: nav.deviceMemory };
  return {
    isMobile,
    hasWebGPU: true,
    shaderF16: adapter.features.has('shader-f16'),
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    deviceMemoryGB: nav.deviceMemory,
  };
}

/** Pure. A value the probe could not read makes no claim. */
export function checkRequirements(probe: DeviceProbe, model: ModelInfo): RequirementsResult {
  const unsupported = (reason: string): RequirementsResult => ({ verdict: 'unsupported', modelId: model.id, reasons: [reason] });

  if (probe.isMobile) return unsupported('On-device AI is not available on phones.');
  if (!probe.hasWebGPU) return unsupported('This browser or device needs WebGPU.');

  let modelId = model.id;
  if (probe.shaderF16 === false) {
    if (!model.f32Id) return unsupported('This model needs a GPU with the shader-f16 feature.');
    modelId = model.f32Id;
  }

  const reasons: string[] = [];
  const smallBuffer = [probe.maxBufferSize, probe.maxStorageBufferBindingSize].some((b) => b !== undefined && b < MIN_BUFFER_BYTES);
  if (smallBuffer) reasons.push('Your GPU limits the size of one memory buffer. The model may not load.');
  if (model.job === 'agent' && probe.deviceMemoryGB !== undefined && probe.deviceMemoryGB < MIN_AGENT_MEMORY_GB) {
    reasons.push(`This browser reports ${probe.deviceMemoryGB} GB of device memory. The assistant model can be slow or fail.`);
  }
  return { verdict: reasons.length ? 'warn' : 'ok', modelId, reasons };
}

/** What a model needs, for the download dialog (#1023). */
export function memoryTierText(model: ModelInfo): string {
  return model.ramTier === 16 ? 'Needs about 16 GB of memory.' : 'Needs about 24 GB of memory, or a graphics card with 8 GB.';
}

/** web-llm's DeviceLostError says "device was lost" and "out of memory (OOM)". */
const OUT_OF_MEMORY = /device was lost|out of memory|\bOOM\b/i;

/** The message for a load that ran out of GPU memory, naming the next smaller model of the same job; null for other errors. */
export function outOfMemoryMessage(error: unknown, modelId: string): string | null {
  const text = error instanceof Error ? error.message : String(error);
  const model = getModelInfo(modelId);
  if (!model || !OUT_OF_MEMORY.test(text)) return null;
  const smaller = getModelsForJob(model.job)
    .filter((m) => m.vramMB < model.vramMB)
    .sort((a, b) => b.vramMB - a.vramMB)[0];
  return smaller ? `Not enough memory for this model. Try ${smaller.name}.` : 'Not enough memory for this model.';
}

/** The id to load for `modelId` on this device. Unknown ids pass through. */
export async function resolveModelId(modelId: string): Promise<string> {
  const model = getModelInfo(modelId);
  if (!model) return modelId;
  return checkRequirements(await probeDevice(false), model).modelId;
}
