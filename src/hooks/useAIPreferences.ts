import { useAISettings, type AISettings } from './useAISettings';
import { useWebLLM } from './useWebLLM';
import { clearModelCache } from '@/lib/webllm';

export interface UseAIPreferencesReturn {
    settings: AISettings;
    isReady: boolean;
    isLoading: boolean;
    loadingProgress: number;
    loadingMessage: string;
    setEnabled: (checked: boolean) => void;
    selectModel: (id: string) => Promise<void>;
    setAutocomplete: (checked: boolean) => void;
    setGrammar: (checked: boolean) => void;
    clearCache: () => Promise<void>;
}

export function useAIPreferences(): UseAIPreferencesReturn {
    const { settings, updateSettings } = useAISettings();
    const { isReady, isLoading, loadingProgress, loadingMessage, initialize, switchModel } = useWebLLM();

    const setEnabled = (checked: boolean) => {
        updateSettings({ enabled: checked });
        if (checked && !isReady && !isLoading) {
            initialize();
        }
    };

    const selectModel = async (id: string) => {
        if (id !== settings.modelId) {
            updateSettings({ modelId: id });
            if (isReady) {
                await switchModel(id);
            }
        }
    };

    const setAutocomplete = (checked: boolean) => {
        updateSettings({ autocompleteEnabled: checked });
    };

    const setGrammar = (checked: boolean) => {
        updateSettings({ grammarEnabled: checked });
    };

    const clearCache = async () => {
        await clearModelCache();
        window.location.reload();
    };

    return {
        settings,
        isReady,
        isLoading,
        loadingProgress,
        loadingMessage,
        setEnabled,
        selectModel,
        setAutocomplete,
        setGrammar,
        clearCache,
    };
}
