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
} from './engine';

export type { RewriteStyle, ChatMessage } from './engine';

export { AVAILABLE_MODELS, DEFAULT_MODEL_ID, getModelInfo, type ModelInfo } from './models';

// Will be available after engine.ts update (Task 4):
// export { getCurrentModelId, setIdleTimeout } from './engine';
