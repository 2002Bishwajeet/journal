export interface ModelInfo {
  id: string;
  name: string;
  parameterCount: string;
  downloadSize: string;
  memoryUsage: string;
  description: string;
  capabilities: ('autocomplete' | 'grammar' | 'rewrite' | 'chat' | 'agentic')[];
  recommended?: boolean;
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B',
    parameterCount: '1.5B',
    downloadSize: '~900 MB',
    memoryUsage: '~1.2 GB',
    description: 'Best balance of quality and speed. Good for all tasks including chat.',
    capabilities: ['autocomplete', 'grammar', 'rewrite', 'chat', 'agentic'],
    recommended: true,
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M',
    parameterCount: '360M',
    downloadSize: '~250 MB',
    memoryUsage: '~400 MB',
    description: 'Ultra-lightweight. Best for autocomplete on low-end devices.',
    capabilities: ['autocomplete', 'grammar', 'rewrite'],
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B',
    parameterCount: '0.5B',
    downloadSize: '~350 MB',
    memoryUsage: '~500 MB',
    description: 'Lightweight with decent instruction following. Good for basic tasks.',
    capabilities: ['autocomplete', 'grammar', 'rewrite', 'chat'],
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B (Legacy)',
    parameterCount: '1B',
    downloadSize: '~700 MB',
    memoryUsage: '~1.5 GB',
    description: 'Previous default. Higher memory usage, may hallucinate.',
    capabilities: ['autocomplete', 'grammar', 'rewrite', 'chat'],
  },
];

export const DEFAULT_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId);
}
