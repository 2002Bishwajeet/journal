import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'journal-ai-settings';
const CURRENT_VERSION = 2;

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

function migrateSettings(raw: Record<string, unknown>): AISettings {
  const version = typeof raw._v === 'number' ? raw._v : 1;

  if (version < 2 && raw.modelId === 'Llama-3.2-1B-Instruct-q4f16_1-MLC') {
    raw.modelId = DEFAULT_SETTINGS.modelId;
  }

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : DEFAULT_SETTINGS.modelId,
    autocompleteEnabled: typeof raw.autocompleteEnabled === 'boolean' ? raw.autocompleteEnabled : DEFAULT_SETTINGS.autocompleteEnabled,
    grammarEnabled: typeof raw.grammarEnabled === 'boolean' ? raw.grammarEnabled : DEFAULT_SETTINGS.grammarEnabled,
  };
}

function loadSettings(): AISettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const settings = migrateSettings(parsed);
      if (((parsed._v as number) ?? 0) < CURRENT_VERSION) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, _v: CURRENT_VERSION }));
      }
      return settings;
    }

    const wasEnabled = localStorage.getItem('webllm-enabled') === 'true';
    if (wasEnabled) {
      const migrated: AISettings = {
        ...DEFAULT_SETTINGS,
        enabled: true,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...migrated, _v: CURRENT_VERSION }));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, _v: CURRENT_VERSION }));
      return next;
    });
  }, []);

  return { settings, updateSettings } as const;
}

// Export for direct access outside React (e.g., in tests)
export { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings };
