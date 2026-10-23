import { useState, useCallback, useEffect } from 'react';
import { DEFAULT_MODEL_ID, DEFAULT_AGENT_MODEL_ID, LEGACY_LLAMA_MODEL_ID } from '@/lib/webllm/models';
import { AI_SETTINGS_KEY, LEGACY_WEBLLM_ENABLED_KEY, readString, writeString, removeKey } from '@/lib/storage';

const STORAGE_KEY = AI_SETTINGS_KEY;
const CURRENT_VERSION = 2;

export interface AISettings {
  enabled: boolean;
  /** The model for autocomplete, grammar and rewrite. */
  modelId: string;
  /** The model for the assistant. */
  agentModelId: string;
  autocompleteEnabled: boolean;
  grammarEnabled: boolean;
}

const DEFAULT_SETTINGS: AISettings = {
  enabled: false,
  modelId: DEFAULT_MODEL_ID,
  agentModelId: DEFAULT_AGENT_MODEL_ID,
  autocompleteEnabled: true,
  grammarEnabled: false,
};

function migrateSettings(raw: Record<string, unknown>): AISettings {
  if (raw.modelId === LEGACY_LLAMA_MODEL_ID) {
    raw.modelId = DEFAULT_SETTINGS.modelId;
  }

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : DEFAULT_SETTINGS.modelId,
    agentModelId: typeof raw.agentModelId === 'string' ? raw.agentModelId : DEFAULT_SETTINGS.agentModelId,
    autocompleteEnabled: typeof raw.autocompleteEnabled === 'boolean' ? raw.autocompleteEnabled : DEFAULT_SETTINGS.autocompleteEnabled,
    grammarEnabled: typeof raw.grammarEnabled === 'boolean' ? raw.grammarEnabled : DEFAULT_SETTINGS.grammarEnabled,
  };
}

function loadSettings(): AISettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = readString(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const settings = migrateSettings(parsed);
      if (((parsed._v as number) ?? 0) < CURRENT_VERSION) {
        writeString(STORAGE_KEY, JSON.stringify({ ...settings, _v: CURRENT_VERSION }));
      }
      return settings;
    }

    const wasEnabled = readString(LEGACY_WEBLLM_ENABLED_KEY) === 'true';
    if (wasEnabled) {
      const migrated: AISettings = {
        ...DEFAULT_SETTINGS,
        enabled: true,
      };
      writeString(STORAGE_KEY, JSON.stringify({ ...migrated, _v: CURRENT_VERSION }));
      removeKey(LEGACY_WEBLLM_ENABLED_KEY);
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
      writeString(STORAGE_KEY, JSON.stringify({ ...next, _v: CURRENT_VERSION }));
      return next;
    });
  }, []);

  return { settings, updateSettings } as const;
}

// Export for direct access outside React (e.g., in tests)
export { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings };
