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
  /** The `q4f32_1` build of this model, for GPUs without the WebGPU `shader-f16` feature. */
  f32Id?: string;
  description: string;
  capabilities: ('autocomplete' | 'grammar' | 'rewrite' | 'chat' | 'agentic')[];
  /** The default for its job. */
  recommended?: boolean;
}

function formatMemory(vramMB: number): string {
  return vramMB >= 1000 ? `~${(vramMB / 1000).toFixed(1)} GB` : `~${Math.round(vramMB / 10) * 10} MB`;
}

const MODELS: Omit<ModelInfo, 'memoryUsage'>[] = [
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
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    name: 'Qwen3 1.7B',
    job: 'agent',
    parameterCount: '1.7B',
    downloadSize: '~1.1 GB',
    vramMB: 2036.66,
    f32Id: 'Qwen3-1.7B-q4f32_1-MLC',
    description: 'The smallest assistant model. Good for simple questions and note actions.',
    capabilities: ['chat', 'agentic'],
    recommended: true,
  },
  {
    id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC',
    name: 'Hermes 3 Llama 3.2 3B',
    job: 'agent',
    parameterCount: '3B',
    downloadSize: '~1.8 GB',
    vramMB: 2263.69,
    f32Id: 'Hermes-3-Llama-3.2-3B-q4f32_1-MLC',
    description: 'Trained to follow multi-step instructions and to use tools.',
    capabilities: ['chat', 'agentic'],
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 3B',
    job: 'agent',
    parameterCount: '3B',
    downloadSize: '~1.8 GB',
    vramMB: 2504.76,
    f32Id: 'Qwen2.5-3B-Instruct-q4f32_1-MLC',
    description: 'A strong all-round model for longer tasks.',
    capabilities: ['chat', 'agentic'],
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    name: 'Qwen3 4B',
    job: 'agent',
    parameterCount: '4B',
    downloadSize: '~2.3 GB',
    vramMB: 3431.59,
    f32Id: 'Qwen3-4B-q4f32_1-MLC',
    description: 'The best quality here. Needs a GPU with plenty of memory.',
    capabilities: ['chat', 'agentic'],
  },
];

export const AVAILABLE_MODELS: ModelInfo[] = MODELS.map((m) => ({ ...m, memoryUsage: formatMemory(m.vramMB) }));

export const DEFAULT_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
export const DEFAULT_AGENT_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';

/** Removed from the catalogue. A saved choice of it falls back to the editor default. */
export const LEGACY_LLAMA_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId);
}

export function getModelsForJob(job: ModelJob): ModelInfo[] {
  return AVAILABLE_MODELS.filter((m) => m.job === job);
}
