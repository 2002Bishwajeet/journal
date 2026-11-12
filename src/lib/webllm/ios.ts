/**
 * On-device AI in the iOS app (#1143). WKWebView has WebGPU from iOS 26. AI shows only
 * where the smallest model can load: a WebGPU adapter, web-llm's smallest buffer limits
 * and an 8 GB device. A model that was in memory when WebKit killed the page is marked
 * too large for this device, so it never loads again in a loop.
 */
import { invokeNative, nativePlatform } from '@/lib/native';
import { tryJsonParse } from '@/lib/utils';
import type { ModelInfo } from './models';
import { checkRequirements, probeDevice, type DeviceProbe, type RequirementsResult } from './requirements';

export const isIOSApp = (): boolean => nativePlatform() === 'ios';

// web-llm's smallest requests (its fallbacks): below these it loads no model.
const MIN_BUFFER_BYTES = 256 * 1024 ** 2;
const MIN_STORAGE_BINDING_BYTES = 128 * 1024 ** 2;
// 8 GB devices (iPhone 15 Pro and later, M-series iPads) report a little under 8 GiB, 6 GB ones under 6 GiB.
const MIN_MEMORY_BYTES = 7 * 1024 ** 3;
// The WebContent process holds the model next to the app: the agent models up to Qwen3.5 2B fit, Qwen3.5 4B does not.
const MAX_VRAM_MB = 2300;

export const NOT_ON_THIS_DEVICE = 'On-device AI is not available on this device.';
export const TOO_LARGE_MESSAGE = 'This model was too large for this device.';
const NEEDS_MORE_MEMORY = 'This model needs more memory than this device has.';
const CELLULAR_NOTICE = 'If you are on cellular data, this download uses it. Connect to Wi-Fi to save data.';

export interface IOSProbe {
  gpu: DeviceProbe;
  /** From the native app; undefined in the Simulator (it reports the Mac's memory) and without the premium plugin. */
  memoryBytes?: number;
}

export async function probeIOS(): Promise<IOSProbe> {
  const [gpu, memoryBytes] = await Promise.all([
    probeDevice(false),
    invokeNative<number | null>('premium', 'device_memory').catch(() => undefined),
  ]);
  return { gpu, memoryBytes: memoryBytes ?? undefined };
}

/** Pure. A value the probe could not read counts as too small. */
export function iosCanRunAI({ gpu, memoryBytes }: IOSProbe): boolean {
  return (
    gpu.hasWebGPU &&
    (gpu.maxBufferSize ?? 0) >= MIN_BUFFER_BYTES &&
    (gpu.maxStorageBufferBindingSize ?? 0) >= MIN_STORAGE_BINDING_BYTES &&
    (memoryBytes ?? 0) >= MIN_MEMORY_BYTES
  );
}

/** The models offered on iOS: the larger ones are hidden. */
export const fitsIOS = (model: ModelInfo): boolean => model.vramMB <= MAX_VRAM_MB;

/** `navigator.connection` where the browser has it; WKWebView does not, so iOS always says so. */
export function mayBeCellular(connection: { type?: string } | undefined): boolean {
  return connection?.type ? connection.type === 'cellular' : true;
}

/** Pure. The download gate's verdict on iOS. */
export function checkIOSRequirements(
  probe: IOSProbe,
  model: ModelInfo,
  crashed: string[],
  connection: { type?: string } | undefined,
): RequirementsResult {
  const reason = !iosCanRunAI(probe)
    ? NOT_ON_THIS_DEVICE
    : crashed.includes(model.id)
      ? TOO_LARGE_MESSAGE
      : !fitsIOS(model)
        ? NEEDS_MORE_MEMORY
        : null;
  if (reason) return { verdict: 'unsupported', modelId: model.id, reasons: [reason] };
  const result = checkRequirements(probe.gpu, model);
  if (result.verdict === 'unsupported' || !mayBeCellular(connection)) return result;
  return { ...result, verdict: 'warn', reasons: [...result.reasons, CELLULAR_NOTICE] };
}

// --- The crash marker ---

const RUNNING_KEY = 'journal-ai-running-model';
const CRASHED_KEY = 'journal-ai-crashed-models';

let runningModel: string | null = null;
let listening = false;

// Written only while the page is visible: iOS also kills a page in the background, which says nothing about the model.
function writeMarker() {
  if (runningModel && document.visibilityState === 'visible') localStorage.setItem(RUNNING_KEY, runningModel);
  else localStorage.removeItem(RUNNING_KEY);
}

/** The model in memory (loading or loaded), or null once it is unloaded or failed. Does nothing off iOS. */
export function setRunningModel(modelId: string | null): void {
  if (!isIOSApp()) return;
  runningModel = modelId;
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', writeMarker);
  }
  writeMarker();
}

/** The models that were in memory when WebKit killed the page. */
export function crashedModels(): string[] {
  const ids = tryJsonParse<unknown>(localStorage.getItem(CRASHED_KEY) ?? '[]');
  return Array.isArray(ids) ? ids : [];
}

/** On launch: marks the model that was in memory when the page died. Returns its id once, else null. */
export function takeCrashedModel(): string | null {
  const id = localStorage.getItem(RUNNING_KEY);
  if (!id) return null;
  localStorage.removeItem(RUNNING_KEY);
  localStorage.setItem(CRASHED_KEY, JSON.stringify([...new Set([...crashedModels(), id])]));
  return id;
}
