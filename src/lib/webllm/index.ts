export {
    initWebLLM,
    unloadWebLLM,
    clearModelCache,
    checkGrammar,
    getAutocompleteSuggestion,
    getActionSuggestions,
    isWebLLMReady,
    isWebLLMLoading,
    isModelCached,
    rewriteText,
    chat,
    getCurrentModelId,
    setIdleTimeout,
} from './engine';

export type { RewriteStyle, ChatMessage } from './engine';

export { createAgentEngine } from './agentEngine';

export {
    AVAILABLE_MODELS,
    DEFAULT_MODEL_ID,
    DEFAULT_AGENT_MODEL_ID,
    getModelInfo,
    getModelsForJob,
    type ModelInfo,
    type ModelJob,
} from './models';
