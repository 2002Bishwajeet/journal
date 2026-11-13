export type ModelJob = 'editor' | 'agent';

export interface ModelInfo {
  id: string;
  name: string;
  /** Which feature uses the model: autocomplete, grammar and rewrite, or the assistant. */
  job: ModelJob;
  parameterCount: string;
  downloadSize: string;
  /** `vram_required_MB` from web-llm's `prebuiltAppConfig`. */
  vramMB: number;
  /** Derived from `vramMB`, for display. */
  memoryUsage: string;
  /** Derived from `vramMB`: the system RAM a laptop with built-in graphics needs, in GB (#1023). */
  ramTier: 16 | 24;
  /**
   * Loads the model with this `context_window_size` instead of the prebuilt 4,096 tokens (#1025).
   * Set only where the eval shows the load still fits on an integrated GPU: the KV cache grows with it.
   */
  contextWindow?: number;
  /** The `q4f32_1` build of this model, for GPUs without the WebGPU `shader-f16` feature. */
  f32Id?: string;
  description: string;
  capabilities: ('autocomplete' | 'grammar' | 'rewrite' | 'chat' | 'agentic')[];
  /** The default for its job. */
  recommended?: boolean;
  /** A badge for a model offered next to the default, such as "Higher quality". */
  badge?: string;
}

function formatMemory(vramMB: number): string {
  return vramMB >= 1000 ? `~${(vramMB / 1000).toFixed(1)} GB` : `~${Math.round(vramMB / 10) * 10} MB`;
}

// An integrated GPU can use about half of the RAM, and the OS and browser need part of the rest.
const ramTier = (vramMB: number): 16 | 24 => (vramMB <= 4000 ? 16 : 24);

const MODELS: Omit<ModelInfo, 'memoryUsage' | 'ramTier'>[] = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M',
    job: 'editor',
    parameterCount: '360M',
    downloadSize: '~250 MB',
    vramMB: 376.06,
    f32Id: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
    description: 'Ultra-lightweight. Best for autocomplete on low-end devices.',
    capabilities: ['autocomplete', 'grammar', 'rewrite'],
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B',
    job: 'editor',
    parameterCount: '0.5B',
    downloadSize: '~350 MB',
    vramMB: 944.62,
    f32Id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    description: 'Small and fast, with decent instruction following. Good for autocomplete, grammar and rewrites.',
    capabilities: ['autocomplete', 'grammar', 'rewrite', 'chat'],
    recommended: true,
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B',
    job: 'editor',
    parameterCount: '1.5B',
    downloadSize: '~900 MB',
    vramMB: 1629.75,
    f32Id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    description: 'Better writing quality than the smaller models. Uses more memory.',
    capabilities: ['autocomplete', 'grammar', 'rewrite', 'chat'],
  },
  {
    id: 'Qwen3.5-2B-q4f16_1-MLC',
    name: 'Qwen3.5 2B',
    job: 'agent',
    parameterCount: '2B',
    downloadSize: '~1.1 GB',
    vramMB: 2245.44,
    f32Id: 'Qwen3.5-2B-q4f32_1-MLC',
    description: 'Good at questions and note edits, at a moderate speed.',
    capabilities: ['chat', 'agentic'],
    recommended: true,
  },
  {
    id: 'Qwen3.5-4B-q4f16_1-MLC',
    name: 'Qwen3.5 4B',
    job: 'agent',
    parameterCount: '4B',
    downloadSize: '~2.4 GB',
    vramMB: 3867.82,
    f32Id: 'Qwen3.5-4B-q4f32_1-MLC',
    description: 'The most accurate assistant model. Slower, and needs more memory.',
    capabilities: ['chat', 'agentic'],
    badge: 'Higher quality',
  },
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    name: 'Qwen3 1.7B',
    job: 'agent',
    parameterCount: '1.7B',
    downloadSize: '~1.1 GB',
    vramMB: 2036.66,
    f32Id: 'Qwen3-1.7B-q4f32_1-MLC',
    description: 'The fastest assistant model. Good for simple questions, but makes more mistakes in edits.',
    capabilities: ['chat', 'agentic'],
  },
];

export const AVAILABLE_MODELS: ModelInfo[] = MODELS.map((m) => ({ ...m, memoryUsage: formatMemory(m.vramMB), ramTier: ramTier(m.vramMB) }));

export const DEFAULT_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
export const DEFAULT_AGENT_MODEL_ID = 'Qwen3.5-2B-q4f16_1-MLC';
/** The agent default before #1023. Saved settings from before #695 have no agent model, and keep this one. */
export const PREVIOUS_AGENT_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';

/** Removed from the catalogue. A saved choice of it falls back to the editor default. */
export const LEGACY_LLAMA_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
/** Removed from the catalogue after #1023. A saved choice of one falls back to the agent default. */
export const REMOVED_AGENT_MODEL_IDS = ['Qwen3-4B-q4f16_1-MLC', 'Qwen2.5-3B-Instruct-q4f16_1-MLC', 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC'];

/**
 * Apple's on-device model (#1266): Foundation Models in the iOS app, through `apple.ts`. Not in
 * `AVAILABLE_MODELS`: Settings offers it only where the native app says it can run.
 */
export const APPLE_MODEL_ID = 'apple-on-device';
export const APPLE_MODEL: ModelInfo = {
  id: APPLE_MODEL_ID,
  name: 'Apple on-device model',
  job: 'editor',
  parameterCount: '3B',
  downloadSize: 'Built in',
  vramMB: 0,
  memoryUsage: 'Outside the app',
  ramTier: 16,
  description: 'The model of Apple Intelligence. Nothing to download, and it does not use the memory of the app.',
  capabilities: ['autocomplete', 'grammar', 'rewrite', 'chat'],
  badge: 'No download',
};

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return modelId === APPLE_MODEL_ID ? APPLE_MODEL : AVAILABLE_MODELS.find((m) => m.id === modelId);
}

export function getModelsForJob(job: ModelJob): ModelInfo[] {
  return AVAILABLE_MODELS.filter((m) => m.job === job);
}
