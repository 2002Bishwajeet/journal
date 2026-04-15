import { useState, useCallback, useEffect, useRef } from 'react';
import { useDeviceType } from './useDeviceType';
import { useAISettings } from './useAISettings';

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
    switchModel: (modelId: string) => Promise<boolean>;
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

    const { settings } = useAISettings();

    const deviceType = useDeviceType();
    const isMobile = deviceType === 'mobile';

    // Debounce timer for grammar check
    const grammarDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Cleanup for deferred auto-init
    const cleanupRef = useRef<(() => void) | null>(null);

    // Check if WebLLM was previously initialized (handles hot-reload and page refresh).
    // Auto-init is deferred so it never blocks the initial render — engine.reload()
    // compiles WASM shaders synchronously on the main thread and would freeze the UI.
    useEffect(() => {
        if (isMobile) return;

        // If module was already loaded (hot-reload scenario), just sync state
        if (webllmModule && webllmModule.isWebLLMReady()) {
            setIsReady(true);
            return;
        }

        if (!settings.enabled) return;

        // Defer heavy initialization until the browser is idle + a short delay,
        // so the initial render, layout, and paint all complete first.
        const timeoutId = setTimeout(() => {
            const rid = typeof requestIdleCallback === 'function'
                ? requestIdleCallback(() => autoInit())
                : setTimeout(() => autoInit(), 100);

            // Store for cleanup
            cleanupRef.current = () => {
                if (typeof cancelIdleCallback === 'function' && typeof rid === 'number') {
                    cancelIdleCallback(rid);
                }
            };
        }, 2000); // 2s delay — let the app fully render first

        async function autoInit() {
            setIsLoading(true);
            setLoadingMessage('Restoring AI...');
            try {
                const module = await getWebLLMModule();
                if (module.isWebLLMReady()) {
                    setIsReady(true);
                    setIsLoading(false);
                    return;
                }

                const success = await module.initWebLLM((progress) => {
                    setLoadingProgress(progress.progress);
                    setLoadingMessage(progress.text);
                }, settings.modelId);

                setIsLoading(false);
                setIsReady(success);
            } catch (error) {
                console.error('[WebLLM] Auto-init failed:', error);
                setIsLoading(false);
            }
        }

        return () => {
            clearTimeout(timeoutId);
            cleanupRef.current?.();
        };
    }, [isMobile, settings.enabled, settings.modelId]);

    // Sync isReady state from the module periodically
    // This ensures all hook consumers see the update when any one initializes WebLLM
    useEffect(() => {
        if (isMobile) return;

        const syncInterval = setInterval(async () => {
            if (!isReady && webllmModule && webllmModule.isWebLLMReady()) {
                setIsReady(true);
            }
        }, 500); // Check every 500ms

        return () => clearInterval(syncInterval);
    }, [isReady, isMobile]);

    const initialize = useCallback(async (): Promise<boolean> => {
        if (isMobile) {
            console.warn('[WebLLM] AI execution is disabled on mobile devices.');
            return false;
        }

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
                return true;
            }

            // Initialize the engine
            const success = await module.initWebLLM((progress) => {
                setLoadingProgress(progress.progress);
                setLoadingMessage(progress.text);
            }, settings.modelId);

            setIsLoading(false);
            setIsReady(success);

            return success;
        } catch (error) {
            console.error('[WebLLM] Failed to load module:', error);
            setIsLoading(false);
            setLoadingMessage('Failed to load AI');
            return false;
        }
    }, [isMobile, settings.modelId]);

    const switchModel = useCallback(async (modelId: string): Promise<boolean> => {
        if (isMobile) return false;
        setIsLoading(true);
        setLoadingMessage('Switching model...');
        setLoadingProgress(0);

        try {
            const module = await getWebLLMModule();
            await module.unloadWebLLM();
            setIsReady(false);

            const success = await module.initWebLLM((progress) => {
                setLoadingProgress(progress.progress);
                setLoadingMessage(progress.text);
            }, modelId);

            setIsLoading(false);
            setIsReady(success);
            return success;
        } catch (error) {
            console.error('[WebLLM] Model switch failed:', error);
            setIsLoading(false);
            return false;
        }
    }, [isMobile]);

    const runGrammarCheck = useCallback(async (text: string) => {
        if (isMobile) return;
        if (!webllmModule || !webllmModule.isWebLLMReady()) return;

        // Debounce grammar check (2 seconds)
        if (grammarDebounceRef.current) {
            clearTimeout(grammarDebounceRef.current);
        }

        grammarDebounceRef.current = setTimeout(async () => {
            const errors = await webllmModule!.checkGrammar(text);
            setGrammarErrors(errors);
        }, 2000);
    }, [isMobile]);

    const rewrite = useCallback(async (text: string, style: RewriteStyle): Promise<string> => {
        if (isMobile) return text;

        // Ensure module is loaded and initialized
        if (!webllmModule || !webllmModule.isWebLLMReady()) {
            const success = await initialize();
            if (!success) return text;
        }
        return webllmModule!.rewriteText(text, style);
    }, [initialize, isMobile]);

    const getSuggestions = useCallback(async (text: string): Promise<string[]> => {
        if (isMobile) return [];
        if (!webllmModule || !webllmModule.isWebLLMReady()) return [];
        return webllmModule.getActionSuggestions(text);
    }, [isMobile]);

    const chat = useCallback(async (messages: ChatMessage[]): Promise<string> => {
        if (isMobile) throw new Error('AI not supported on mobile');

        // Ensure module is loaded and initialized
        if (!webllmModule || !webllmModule.isWebLLMReady()) {
            const success = await initialize();
            if (!success) throw new Error('Failed to initialize AI');
        }
        return webllmModule!.chat(messages);
    }, [initialize, isMobile]);

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
        switchModel,
        runGrammarCheck,
        rewrite,
        getSuggestions,
        chat,
    };
}
