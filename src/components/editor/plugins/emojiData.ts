
import { gemoji } from 'gemoji';

export interface EmojiItem {
    name: string;
    emoji: string;
    shortcodes: string[];
    tags: string[];
    skin_tones?: boolean;
}

// Transform gemoji data to our structure
export const emojis: EmojiItem[] = gemoji.map(item => ({
    name: item.description,
    emoji: item.emoji,
    shortcodes: item.names.map(n => `:${n}:`),
    tags: item.tags
}));

export const SKIN_TONES = [
    { name: 'Default', value: '' },
    { name: 'Light', value: '🏻' },
    { name: 'Medium-Light', value: '🏼' },
    { name: 'Medium', value: '🏽' },
    { name: 'Medium-Dark', value: '🏾' },
    { name: 'Dark', value: '🏿' },
];

// Regex to match emojis that likely support skin tones (human-like).
// This is a heuristic since we don't have the full metadata, but it covers hands, people, etc.
const SKIN_TONE_SUPPORTED_REGEX = /[\u{1F385}\u{1F3C2}-\u{1F3C7}\u{1F3CA}-\u{1F3CC}\u{1F442}-\u{1F443}\u{1F446}-\u{1F450}\u{1F466}-\u{1F478}\u{1F481}-\u{1F483}\u{1F485}-\u{1F487}\u{1F4AA}\u{1F574}-\u{1F575}\u{1F57A}\u{1F590}\u{1F595}-\u{1F596}\u{1F645}-\u{1F647}\u{1F64B}-\u{1F64F}\u{1F6A3}\u{1F6B4}-\u{1F6B6}\u{1F90F}\u{1F918}-\u{1F91F}\u{1F926}\u{1F930}-\u{1F939}\u{1F9D1}-\u{1F9DD}]/u;

export function hasSkinTones(emoji: string): boolean {
    return SKIN_TONE_SUPPORTED_REGEX.test(emoji);
}

export function applySkinTone(emoji: string, tone: string): string {
    if (!tone) return emoji;
    // Strip existing tone first
    const base = emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/u, '');
    return base + tone;
}

export const suggestionItems = ({ query }: { query: string }) => {
    if (query.length === 0) {
        return emojis.slice(0, 5); // Return top 5 when no query
    }

    const lowerQuery = query.toLowerCase();

    return emojis
        .filter(item =>
            item.name.toLowerCase().includes(lowerQuery) ||
            item.shortcodes.some(code => code.includes(lowerQuery)) ||
            item.tags.some(tag => tag.startsWith(lowerQuery))
        )
        .slice(0, 10);
};
