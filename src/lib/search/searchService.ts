import { tryJsonParse } from "@/lib/utils";

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source?: string;
}

// List of reliable public instances with JSON API enabled
// We cycle through them if one fails
const SEARXNG_INSTANCES = [
    'https://searx.be',
    'https://search.ononoki.org',
    'https://northboot.xyz',
    'https://searx.work',
];

/**
 * Perform a web search using public SearXNG instances
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
    // try each instance until one works
    for (const instance of SEARXNG_INSTANCES) {
        try {
            const results = await queryInstance(instance, query);
            if (results.length > 0) {
                return results;
            }
        } catch (error) {
            console.warn(`Search failed on ${instance}:`, error);
            // Continue to next instance
        }
    }

    throw new Error("All search instances failed");
}

async function queryInstance(baseUrl: string, query: string): Promise<SearchResult[]> {
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.append('q', query);
    url.searchParams.append('format', 'json');
    url.searchParams.append('language', 'en');

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        },
        // Abort after 5 seconds
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();

    if (!data.results || !Array.isArray(data.results)) {
        return [];
    }

    // Parse and normalize results
    return data.results.slice(0, 5).map((result: any) => ({
        title: result.title || 'No Title',
        url: result.url,
        snippet: result.content || result.snippet || '',
        source: result.engine,
    }));
}
