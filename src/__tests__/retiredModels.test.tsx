// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AGENT_MODEL_ID, PREVIOUS_AGENT_MODEL_ID, getModelInfo, getModelsForJob } from '@/lib/webllm/models';
import { STORAGE_KEY, loadSettings } from '@/hooks/useAISettings';
import AIModelList from '@/components/settings/sections/AIModelList';

// Qwen3 4B, Qwen 2.5 3B and Hermes 3 3B scored below Qwen3.5 2B in the #1023 eval, so the picker
// stops offering them. A saved choice of one keeps working, and Settings shows it until it is changed.

const RETIRED = ['Qwen3-4B-q4f16_1-MLC', 'Qwen2.5-3B-Instruct-q4f16_1-MLC', 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC'];
const ids = (selectedId?: string) => getModelsForJob('agent', selectedId).map((m) => m.id);

describe('assistant model picker', () => {
    it('offers Qwen3.5 2B, Qwen3.5 4B and Qwen3 1.7B', () => {
        expect(ids(DEFAULT_AGENT_MODEL_ID)).toEqual(['Qwen3.5-2B-q4f16_1-MLC', 'Qwen3.5-4B-q4f16_1-MLC', PREVIOUS_AGENT_MODEL_ID]);
        expect(ids()).toEqual(ids(DEFAULT_AGENT_MODEL_ID));
    });

    it.each(RETIRED)('lists %s only while it is the saved choice', (id) => {
        expect(ids(id)).toContain(id);
        expect(ids(id).filter((m) => RETIRED.includes(m))).toEqual([id]);
        expect(ids(DEFAULT_AGENT_MODEL_ID)).not.toContain(id);
    });

    it('keeps the retired models in the catalogue, so a saved choice still loads', () => {
        for (const id of RETIRED) expect(getModelInfo(id)?.retired, id).toBe(true);
    });

    it('shows a retired saved choice as selected, with a hint to switch', () => {
        const html = renderToStaticMarkup(
            <AIModelList label="Assistant" models={getModelsForJob('agent', RETIRED[0])} selectedModelId={RETIRED[0]} onSelect={() => {}} disabled={false} />,
        );
        expect(html).toMatch(/checked="" value="Qwen3-4B-q4f16_1-MLC"/);
        expect(html).toContain('Retired: switch to Qwen3.5 2B');
        expect(html.match(/Retired:/g)).toHaveLength(1);
    });

    it('shows no hint when the saved choice is not retired', () => {
        const html = renderToStaticMarkup(
            <AIModelList label="Assistant" models={getModelsForJob('agent', DEFAULT_AGENT_MODEL_ID)} selectedModelId={DEFAULT_AGENT_MODEL_ID} onSelect={() => {}} disabled={false} />,
        );
        expect(html).not.toContain('Retired');
    });
});

describe('settings migration for retired models', () => {
    beforeEach(() => localStorage.clear());

    it.each(RETIRED)('keeps a saved %s choice, so nothing downloads again', (id) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: 1, enabled: true, agentModelId: id }));
        expect(loadSettings().agentModelId).toBe(id);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).agentModelId).toBe(id);
    });
});
