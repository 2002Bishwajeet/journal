import type * as WebLLMTypes from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID } from './models';

let webllmModule: typeof WebLLMTypes | null = null;
let engine: WebLLMTypes.MLCEngineInterface | null = null;
let worker: Worker | null = null;
let isLoading = false;
let modelLoaded = false; // Track if model is actually loaded and ready

let currentModelId: string = DEFAULT_MODEL_ID;

// Auto-GC configuration
let idleTimeoutMs = 5 * 60 * 1000; // Default 5 minutes
let lastActivityTimestamp = 0;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

export function setIdleTimeout(minutes: number): void {
    idleTimeoutMs = Math.max(1, minutes) * 60 * 1000;
}

/**
 * Track activity to reset the idle timer
 */
function trackActivity(): void {
    lastActivityTimestamp = Date.now();
}

/**
 * Start the idle checker that will unload WebLLM after inactivity
 */
function startIdleChecker(): void {
    if (idleCheckInterval) return;

    idleCheckInterval = setInterval(() => {
        if (engine && lastActivityTimestamp > 0) {
            const idleTime = Date.now() - lastActivityTimestamp;
            if (idleTime >= idleTimeoutMs) {
                console.log(`[WebLLM] Idle for ${Math.round(idleTimeoutMs / 60000)}+ minutes, unloading to free memory...`);
                unloadWebLLM();
            }
        }
    }, 60 * 1000); // Check every minute
}

/**
 * Stop the idle checker
 */
function stopIdleChecker(): void {
    if (idleCheckInterval) {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
    }
}

/**
 * Unload WebLLM engine to free memory (~2-3GB)
 */
export async function unloadWebLLM(): Promise<void> {
    if (engine) {
        try {
            // MLCEngine has an unload method to free GPU/WASM memory
            if (typeof engine.unload === 'function') {
                await engine.unload();
            }
        } catch (error) {
            console.warn('[WebLLM] Error during unload:', error);
        }
        engine = null;
        modelLoaded = false;
        console.log('[WebLLM] Engine unloaded, memory freed');
    }
    if (worker) {
        worker.terminate();
        worker = null;
    }
    stopIdleChecker();
    lastActivityTimestamp = 0;
}

/**
 * Initialize WebLLM engine with model stored in OPFS
 */
export async function initWebLLM(
    onProgress?: (progress: WebLLMTypes.InitProgressReport) => void,
    modelId?: string
): Promise<boolean> {
    const targetModel = modelId || currentModelId;

    // If a different model is requested, unload current first
    if (engine && modelLoaded && targetModel !== currentModelId) {
        await unloadWebLLM();
    }

    if (engine && modelLoaded) return true;
    if (isLoading) return false;

    isLoading = true;
    modelLoaded = false;
    currentModelId = targetModel;

    try {
        if (!webllmModule) {
            webllmModule = await import('@mlc-ai/web-llm');
        }

        // Use WebWorkerMLCEngine to run all heavy work (WASM compilation,
        // model loading, inference) off the main thread.
        if (!worker) {
            worker = new Worker(
                new URL('./worker.ts', import.meta.url),
                { type: 'module' }
            );
        }
        engine = new webllmModule.WebWorkerMLCEngine(worker);

        if (onProgress) {
            engine.setInitProgressCallback(onProgress);
        }

        await engine.reload(currentModelId);

        isLoading = false;
        modelLoaded = true;
        trackActivity();
        startIdleChecker();
        return true;
    } catch (error) {
        console.error('[WebLLM] Failed to initialize:', error);
        isLoading = false;
        modelLoaded = false;
        return false;
    }
}

/**
 * Check grammar and spelling
 */
export async function checkGrammar(text: string): Promise<string[]> {
    if (!engine || !modelLoaded) return [];
    trackActivity();

    try {
        const response = await engine.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a grammar checker. Check the text for grammar and spelling errors ONLY.
Rules:
- Return a JSON array of strings describing errors found.
- Each string must be under 80 characters.
- If no errors exist, return exactly: []
- Do NOT explain, do NOT add commentary.
- Do NOT invent errors that aren't there.
- Maximum 5 errors per check.
Output format: ["error 1", "error 2"]`,
                },
                {
                    role: 'user',
                    content: text.slice(0, 500),
                },
            ],
            max_tokens: 150,
            temperature: 0.0,
        });

        const result = response.choices[0]?.message?.content || '[]';
        try {
            const parsed = JSON.parse(result);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((e: unknown): e is string => typeof e === 'string' && e.length < 200)
                .slice(0, 5);
        } catch {
            return [];
        }
    } catch (error) {
        console.error('[WebLLM] Grammar check failed:', error);
        return [];
    }
}

/**
 * Get autocomplete suggestion
 */
export async function getAutocompleteSuggestion(text: string): Promise<string> {
    if (!engine || !modelLoaded) return '';
    trackActivity();

    try {
        const response = await engine.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'Continue the user\'s text naturally. Output ONLY the next few words (max 15 words). No explanation, no repetition of input, no quotes.',
                },
                {
                    role: 'user',
                    content: text.slice(-200),
                },
            ],
            max_tokens: 30,
            temperature: 0.3,
        });

        const raw = response.choices[0]?.message?.content || '';
        const trimmed = raw.trim();
        if (trimmed.length > 80) return ''; // Hallucination guard
        return trimmed;
    } catch (error) {
        console.error('[WebLLM] Autocomplete failed:', error);
        return '';
    }
}

/**
 * Get action suggestions (e.g., "Add to calendar", "Create todo")
 */
export async function getActionSuggestions(text: string): Promise<string[]> {
    if (!engine || !modelLoaded) return [];
    trackActivity();

    try {
        const response = await engine.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `Analyze the note and suggest 0-3 actions. Return ONLY a JSON array.
Valid actions: "Add to calendar", "Create todo", "Set reminder", "Add tag", "Create checklist"
If no actions are relevant, return: []
Output format: ["action1", "action2"]`,
                },
                {
                    role: 'user',
                    content: text.slice(0, 500),
                },
            ],
            max_tokens: 60,
            temperature: 0.1,
        });

        const result = response.choices[0]?.message?.content || '[]';
        try {
            const parsed = JSON.parse(result);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((e: unknown): e is string => typeof e === 'string' && e.length < 100)
                .slice(0, 3);
        } catch {
            return [];
        }
    } catch (error) {
        console.error('[WebLLM] Action suggestions failed:', error);
        return [];
    }
}

/**
 * Check if WebLLM is available and model is loaded
 */
export function isWebLLMReady(): boolean {
    return engine !== null && modelLoaded;
}

/**
 * Get loading state
 */
export function isWebLLMLoading(): boolean {
    return isLoading;
}

/**
 * Get the currently loaded model ID
 */
export function getCurrentModelId(): string {
    return currentModelId;
}

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

const STYLE_PROMPTS: Record<RewriteStyle, string> = {
    proofread: 'Fix any grammar, spelling, and punctuation errors. Keep the original style and meaning.',
    rewrite: 'Rewrite the text to improve clarity and flow while keeping the same meaning.',
    friendly: 'Rewrite the text in a warm, friendly, casual tone.',
    professional: 'Rewrite the text in a formal, professional business tone.',
    concise: 'Rewrite the text to be more concise and direct. Remove unnecessary words.',
    summary: 'Summarize the key points of this text in 2-3 sentences.',
    keypoints: 'Extract the key points from this text as a bullet list.',
    list: 'Convert this text into a structured bullet point list.',
    table: 'Convert this text into a markdown table. Use this EXACT format with pipes and dashes:\\n| Column1 | Column2 |\\n|---------|---------|\\n| Data1 | Data2 |\\nOutput ONLY the table with no explanation or extra text.',
};

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Chat with the LLM
 */
export async function chat(messages: ChatMessage[]): Promise<string> {
    if (!engine || !modelLoaded) return '';
    trackActivity();

    try {
        const response = await engine.chat.completions.create({
            messages,
            max_tokens: 512,  // Reduced to encourage concise answers
            temperature: 0.4, // Lower temperature = less hallucination
            top_p: 0.9,       // Nucleus sampling for coherence
        });

        return response.choices[0]?.message?.content || '';
    } catch (error) {
        console.error('[WebLLM] Chat failed:', error);
        throw error;
    }
}

/**
 * Rewrite text with a specific style
 */
export async function rewriteText(text: string, style: RewriteStyle): Promise<string> {
    if (!engine || !modelLoaded) return text;
    trackActivity();

    try {
        const response = await engine.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a writing assistant. ${STYLE_PROMPTS[style]} Output ONLY the rewritten text, no explanation.`,
                },
                {
                    role: 'user',
                    content: text.slice(0, 2000), // Limit input
                },
            ],
            max_tokens: 500,
            temperature: 0.3,
        });

        return response.choices[0]?.message?.content || text;
    } catch (error) {
        console.error('[WebLLM] Rewrite failed:', error);
        return text;
    }
}
