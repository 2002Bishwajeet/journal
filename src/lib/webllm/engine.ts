import type * as WebLLMTypes from '@mlc-ai/web-llm';

let webllmModule: typeof WebLLMTypes | null = null;
let engine: WebLLMTypes.MLCEngine | null = null;
let isLoading = false;
let modelLoaded = false; // Track if model is actually loaded and ready

const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// Auto-GC configuration
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let lastActivityTimestamp = 0;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

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
            if (idleTime >= IDLE_TIMEOUT_MS) {
                console.log('[WebLLM] Idle for 5+ minutes, unloading to free memory...');
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
    stopIdleChecker();
    lastActivityTimestamp = 0;
}

/**
 * Initialize WebLLM engine with model stored in OPFS
 */
export async function initWebLLM(
    onProgress?: (progress: WebLLMTypes.InitProgressReport) => void
): Promise<boolean> {
    if (engine && modelLoaded) return true;
    if (isLoading) return false;

    isLoading = true;
    modelLoaded = false;

    try {
        if (!webllmModule) {
            webllmModule = await import('@mlc-ai/web-llm');
        }

        engine = new webllmModule.MLCEngine();

        if (onProgress) {
            engine.setInitProgressCallback(onProgress);
        }

        await engine.reload(MODEL_ID);

        isLoading = false;
        modelLoaded = true; // Model is now fully loaded
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
                    content: 'You are a helpful writing assistant. Check the following text for grammar and spelling errors. Return ONLY a JSON array of error descriptions. If no errors, return []. Do not include any other text.',
                },
                {
                    role: 'user',
                    content: text.slice(0, 500), // Limit to first 500 chars
                },
            ],
            max_tokens: 200,
            temperature: 0.1,
        });

        const result = response.choices[0]?.message?.content || '[]';
        try {
            return JSON.parse(result);
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
                    content: 'Complete the following text with a natural continuation. Output ONLY the completion, no explanation. Keep it brief (under 20 words).',
                },
                {
                    role: 'user',
                    content: text.slice(-200), // Last 200 chars
                },
            ],
            max_tokens: 50,
            temperature: 0.7,
        });

        return response.choices[0]?.message?.content || '';
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
                    content: 'Analyze the following note text and suggest 0-3 helpful actions the user might want to take. Examples: "Add to calendar", "Create todo", "Set reminder". Return ONLY a JSON array of action strings. If no relevant actions, return [].',
                },
                {
                    role: 'user',
                    content: text.slice(0, 1000),
                },
            ],
            max_tokens: 100,
            temperature: 0.3,
        });

        const result = response.choices[0]?.message?.content || '[]';
        try {
            return JSON.parse(result);
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
