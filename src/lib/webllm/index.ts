export {
    initWebLLM,
    unloadWebLLM,
    checkGrammar,
    getAutocompleteSuggestion,
    getActionSuggestions,
    isWebLLMReady,
    isWebLLMLoading,
    rewriteText,
    chat,
    getCurrentModelId,
    setIdleTimeout,
} from './engine';

export type { RewriteStyle, ChatMessage } from './engine';

export { AVAILABLE_MODELS, DEFAULT_MODEL_ID, getModelInfo, type ModelInfo } from './models';
