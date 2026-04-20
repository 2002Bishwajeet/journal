// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, getModelInfo } from '@/lib/webllm/models';
import { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings } from '@/hooks/useAISettings';

describe('Model Registry', () => {
  it('should have at least one model', () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
  });

  it('should have exactly one recommended model', () => {
    const recommended = AVAILABLE_MODELS.filter((m) => m.recommended);
    expect(recommended).toHaveLength(1);
  });

  it('DEFAULT_MODEL_ID should match the recommended model', () => {
    const recommended = AVAILABLE_MODELS.find((m) => m.recommended);
    expect(recommended?.id).toBe(DEFAULT_MODEL_ID);
  });

  it('getModelInfo should return model for valid ID', () => {
    const model = getModelInfo(DEFAULT_MODEL_ID);
    expect(model).toBeDefined();
    expect(model?.name).toBe('Qwen 2.5 1.5B');
  });

  it('getModelInfo should return undefined for invalid ID', () => {
    expect(getModelInfo('nonexistent-model')).toBeUndefined();
  });

  it('all models should have required fields', () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.parameterCount).toBeTruthy();
      expect(model.capabilities.length).toBeGreaterThan(0);
    }
  });
});

describe('AI Settings - loadSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return defaults when no settings stored', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('should load stored settings', () => {
    const custom = { ...DEFAULT_SETTINGS, enabled: true, grammarEnabled: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    const settings = loadSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.grammarEnabled).toBe(true);
  });

  it('should merge defaults for missing fields', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true }));
    const settings = loadSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.modelId).toBe(DEFAULT_SETTINGS.modelId);
    expect(settings.autocompleteEnabled).toBe(DEFAULT_SETTINGS.autocompleteEnabled);
  });

  it('should migrate old webllm-enabled key', () => {
    localStorage.setItem('webllm-enabled', 'true');
    const settings = loadSettings();
    expect(settings.enabled).toBe(true);
    expect(localStorage.getItem('webllm-enabled')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it('should preserve Llama model ID during migration', () => {
    localStorage.setItem('webllm-enabled', 'true');
    const settings = loadSettings();
    expect(settings.modelId).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
  });

  it('should handle corrupted data gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});
