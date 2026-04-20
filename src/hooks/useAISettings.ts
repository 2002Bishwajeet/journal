import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'journal-ai-settings';

export interface AISettings {
  enabled: boolean;
  modelId: string;
  autocompleteEnabled: boolean;
  grammarEnabled: boolean;
}

const DEFAULT_SETTINGS: AISettings = {
  enabled: false,
  modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  autocompleteEnabled: true,
  grammarEnabled: false,
};

function loadSettings(): AISettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }

    // Migrate from old localStorage key
    const wasEnabled = localStorage.getItem('webllm-enabled') === 'true';
    if (wasEnabled) {
      const migrated: AISettings = {
        ...DEFAULT_SETTINGS,
        enabled: true,
        modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', // Keep their old model
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem('webllm-enabled');
      return migrated;
    }
  } catch {
    // Corrupted data, reset
  }
  return DEFAULT_SETTINGS;
}

export function useAISettings() {
  const [settings, setSettingsState] = useState<AISettings>(loadSettings);

  // Sync across tabs via StorageEvent
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setSettingsState(loadSettings());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const updateSettings = useCallback((patch: Partial<AISettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, updateSettings } as const;
}

// Export for direct access outside React (e.g., in tests)
export { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings };
