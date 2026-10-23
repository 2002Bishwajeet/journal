import { getModelInfo, type ModelInfo } from './models';

export interface DeviceProbe {
  isMobile: boolean;
  /** `navigator.gpu` gave us an adapter. */
  hasWebGPU: boolean;
  /** `undefined` when there is no adapter to ask. */
  shaderF16?: boolean;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
  /** GB. Chrome only, and capped at 8, so only a low value means anything. */
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
const MIN_AGENT_MEMORY_GB = 4;

interface GpuAdapterLike {
  features: { has(name: string): boolean };
  limits: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
}

export async function probeDevice(isMobile: boolean): Promise<DeviceProbe> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> };
  };
  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = (await nav.gpu?.requestAdapter()) ?? null;
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

/** The id to load for `modelId` on this device. Unknown ids pass through. */
export async function resolveModelId(modelId: string): Promise<string> {
  const model = getModelInfo(modelId);
  if (!model) return modelId;
  return checkRequirements(await probeDevice(false), model).modelId;
}
