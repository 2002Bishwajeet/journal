import { toast } from 'sonner';
import { useAISettings, type AISettings } from './useAISettings';
import { useWebLLM } from './useWebLLM';
import { clearModelCache, getModelInfo, unloadWebLLM } from '@/lib/webllm';

export interface UseAIPreferencesReturn {
    settings: AISettings;
    isReady: boolean;
    isLoading: boolean;
    loadingProgress: number;
    loadingMessage: string;
    error: string | null;
    isSupported: boolean;
    initialize: () => Promise<boolean>;
    setEnabled: (checked: boolean) => Promise<void>;
    selectModel: (id: string) => Promise<void>;
    setAutocomplete: (checked: boolean) => void;
    setGrammar: (checked: boolean) => void;
    clearCache: () => Promise<void>;
}

const modelName = (id: string) => getModelInfo(id)?.name ?? id;

export function useAIPreferences(): UseAIPreferencesReturn {
    const { settings, updateSettings } = useAISettings();
    const {
        isReady,
        isLoading,
        loadingProgress,
        loadingMessage,
        error,
        isSupported,
        initialize,
        switchModel,
    } = useWebLLM();

    const setEnabled = async (checked: boolean) => {
        updateSettings({ enabled: checked });
        // Not gated on isReady: it stays true after an unload. initialize()
        // itself returns early when the engine is already loaded.
        if (checked && !isLoading) {
            initialize();
        }
        if (!checked && (isReady || isLoading)) {
            await unloadWebLLM();
        }
    };

    const selectModel = async (id: string) => {
        if (isLoading || id === settings.modelId) return;
        const previousId = settings.modelId;
        updateSettings({ modelId: id });
        if (isReady && !(await switchModel(id))) {
            updateSettings({ modelId: previousId });
            toast.error(`Couldn't switch to ${modelName(id)}. Kept ${modelName(previousId)}.`);
        }
    };

    const setAutocomplete = (checked: boolean) => {
        updateSettings({ autocompleteEnabled: checked });
    };

    const setGrammar = (checked: boolean) => {
        updateSettings({ grammarEnabled: checked });
    };

    const clearCache = async () => {
        // Turn AI off first so auto-init doesn't immediately re-download the model
        if (settings.enabled) updateSettings({ enabled: false });
        await clearModelCache();
        toast.success("Model files removed. They'll download again next time AI loads.");
    };

    return {
        settings,
        isReady,
        isLoading,
        loadingProgress,
        loadingMessage,
        error,
        isSupported,
        initialize,
        setEnabled,
        selectModel,
        setAutocomplete,
        setGrammar,
        clearCache,
    };
}
