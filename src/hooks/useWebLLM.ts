import { useState, useCallback, useEffect, useRef } from 'react';

// Re-export type for convenience (type-only import doesn't add to bundle)
export type RewriteStyle =
    | 'proofread'
    | 'rewrite'
    | 'friendly'
    | 'professional'
    | 'concise'
    | 'summary'
    | 'keypoints'
    | 'list'
    | 'table';

export type { ChatMessage } from '@/lib/webllm';
import type { ChatMessage } from '@/lib/webllm';

interface UseWebLLMResult {
    // State
    isReady: boolean;
    isLoading: boolean;
    loadingProgress: number;
    loadingMessage: string;
    grammarErrors: string[];

    // Actions
    initialize: () => Promise<boolean>;
    runGrammarCheck: (text: string) => Promise<void>;
    rewrite: (text: string, style: RewriteStyle) => Promise<string>;
    getSuggestions: (text: string) => Promise<string[]>;
    chat: (messages: ChatMessage[]) => Promise<string>;
}

// Lazy-loaded module reference
let webllmModule: typeof import('@/lib/webllm') | null = null;

async function getWebLLMModule() {
    if (!webllmModule) {
        webllmModule = await import('@/lib/webllm');
    }
    return webllmModule;
}

/**
 * React hook for WebLLM integration with lazy loading.
 * The ~7MB WebLLM bundle is only loaded when initialize() is called.
 */
export function useWebLLM(): UseWebLLMResult {
    const [isReady, setIsReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [grammarErrors, setGrammarErrors] = useState<string[]>([]);

    // Debounce timer for grammar check
    const grammarDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Check if WebLLM was previously initialized (handles hot-reload and page refresh)
    useEffect(() => {
        const checkIfAlreadyReady = async () => {
            // If module was already loaded (hot-reload scenario)
            if (webllmModule && webllmModule.isWebLLMReady()) {
                setIsReady(true);
                return;
            }

            // Check if user previously enabled AI - auto-initialize on reload
            // The model is cached in OPFS, so reloading is much faster
            const wasEnabled = localStorage.getItem('webllm-enabled') === 'true';
            if (wasEnabled) {
                setIsLoading(true);
                setLoadingMessage('Restoring AI...');

                try {
                    const module = await getWebLLMModule();

                    // Check if already ready after loading module
                    if (module.isWebLLMReady()) {
                        setIsReady(true);
                        setIsLoading(false);
                        return;
                    }

                    // Initialize from cached model
                    const success = await module.initWebLLM((progress) => {
                        setLoadingProgress(progress.progress);
                        setLoadingMessage(progress.text);
                    });

                    setIsLoading(false);
                    setIsReady(success);
                } catch (error) {
                    console.error('[WebLLM] Auto-init failed:', error);
                    setIsLoading(false);
                    // Clear the flag if auto-init fails
                    localStorage.removeItem('webllm-enabled');
                }
            }
        };
        checkIfAlreadyReady();
    }, []);

    const initialize = useCallback(async (): Promise<boolean> => {
        // Check if already ready (module loaded and engine initialized)
        if (webllmModule && webllmModule.isWebLLMReady()) {
            setIsReady(true);
            return true;
        }

        setIsLoading(true);
        setLoadingMessage('Loading AI module...');

        try {
            // Dynamically import the WebLLM module
            const module = await getWebLLMModule();

            // Check if engine is already initialized
            if (module.isWebLLMReady()) {
                setIsReady(true);
                setIsLoading(false);
                localStorage.setItem('webllm-enabled', 'true');
                return true;
            }

            // Initialize the engine
            const success = await module.initWebLLM((progress) => {
                setLoadingProgress(progress.progress);
                setLoadingMessage(progress.text);
            });

            setIsLoading(false);
            setIsReady(success);

            // Persist AI enabled state
            if (success) {
                localStorage.setItem('webllm-enabled', 'true');
            }

            return success;
        } catch (error) {
            console.error('[WebLLM] Failed to load module:', error);
            setIsLoading(false);
            setLoadingMessage('Failed to load AI');
            return false;
        }
    }, []);

    const runGrammarCheck = useCallback(async (text: string) => {
        if (!webllmModule || !webllmModule.isWebLLMReady()) return;

        // Debounce grammar check (2 seconds)
        if (grammarDebounceRef.current) {
            clearTimeout(grammarDebounceRef.current);
        }

        grammarDebounceRef.current = setTimeout(async () => {
            const errors = await webllmModule!.checkGrammar(text);
            setGrammarErrors(errors);
        }, 2000);
    }, []);

    const rewrite = useCallback(async (text: string, style: RewriteStyle): Promise<string> => {
        // Ensure module is loaded and initialized
        if (!webllmModule || !webllmModule.isWebLLMReady()) {
            const success = await initialize();
            if (!success) return text;
        }
        return webllmModule!.rewriteText(text, style);
    }, [initialize]);

    const getSuggestions = useCallback(async (text: string): Promise<string[]> => {
        if (!webllmModule || !webllmModule.isWebLLMReady()) return [];
        return webllmModule.getActionSuggestions(text);
    }, []);

    const chat = useCallback(async (messages: ChatMessage[]): Promise<string> => {
        // Ensure module is loaded and initialized
        if (!webllmModule || !webllmModule.isWebLLMReady()) {
            const success = await initialize();
            if (!success) throw new Error('Failed to initialize AI');
        }
        return webllmModule!.chat(messages);
    }, [initialize]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (grammarDebounceRef.current) {
                clearTimeout(grammarDebounceRef.current);
            }
        };
    }, []);

    return {
        isReady,
        isLoading,
        loadingProgress,
        loadingMessage,
        grammarErrors,
        initialize,
        runGrammarCheck,
        rewrite,
        getSuggestions,
        chat,
    };
}
