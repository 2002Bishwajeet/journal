import { useEffect, useState } from 'react';

export type EditorFont = 'sans' | 'serif' | 'mono';
export type EditorWidth = 'narrow' | 'default' | 'full';

const FONT_STORAGE_KEY = 'journal-editor-font';
const WIDTH_STORAGE_KEY = 'journal-editor-width';

const FONTS: readonly EditorFont[] = ['sans', 'serif', 'mono'];
const WIDTHS: readonly EditorWidth[] = ['narrow', 'default', 'full'];

function getStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    const stored = localStorage.getItem(key);
    return allowed.find((value) => value === stored) ?? fallback;
}

function apply(attribute: string, value: string): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(attribute, value);
}

/**
 * Editor font and note-column width, persisted in localStorage and applied as
 * `data-editor-font` / `data-editor-width` on <html> (styled in index.css).
 */
export function useEditorAppearance() {
    const [font, setFontState] = useState<EditorFont>(() =>
        getStored(FONT_STORAGE_KEY, FONTS, 'sans'),
    );
    const [width, setWidthState] = useState<EditorWidth>(() =>
        getStored(WIDTH_STORAGE_KEY, WIDTHS, 'default'),
    );

    // Apply the stored preferences once on mount; later changes go through the setters.
    useEffect(() => {
        apply('data-editor-font', font);
        apply('data-editor-width', width);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- apply the stored values once on mount

    const setFont = (next: EditorFont) => {
        localStorage.setItem(FONT_STORAGE_KEY, next);
        apply('data-editor-font', next);
        setFontState(next);
    };

    const setWidth = (next: EditorWidth) => {
        localStorage.setItem(WIDTH_STORAGE_KEY, next);
        apply('data-editor-width', next);
        setWidthState(next);
    };

    return { font, setFont, width, setWidth } as const;
}
