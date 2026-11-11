import type { FRAME_TOKENS } from './liveBlocks';

/**
 * The CSS variables a block's frame takes its look from, read on the host's `<html>`, with
 * Journal's own values (its src/index.css) as the default for any the host does not set. A
 * host restyles blocks by setting these variables: `--font-sans` and every FRAME_TOKENS name.
 */
export const THEME_DEFAULTS: Record<'light' | 'dark', Record<(typeof FRAME_TOKENS)[number] | '--font-sans', string>> = {
  light: {
    '--font-sans': "'Inter Variable', system-ui, sans-serif",
    '--background': '#FDFCF8',
    '--foreground': '#2C2B29',
    '--card': '#FFFFFF',
    '--card-foreground': '#2C2B29',
    '--popover': '#FFFFFF',
    '--popover-foreground': '#2C2B29',
    '--muted': '#F2F0E9',
    '--muted-foreground': '#8A8780',
    '--border': '#E6E4DD',
    '--input': '#FFFFFF',
    '--accent': '#F7F5F0',
    '--accent-foreground': '#2C2B29',
    '--secondary': '#F2F0E9',
    '--secondary-foreground': '#2C2B29',
    '--primary': '#2C2B29',
    '--primary-foreground': '#FFFFFF',
    '--destructive': '#ef4444',
    '--destructive-foreground': '#FFFFFF',
    '--ring': '#2C2B29',
    '--radius': '0.5rem',
    '--chart-1': '#39362E',
    '--chart-2': '#8A5344',
    '--chart-3': '#718968',
    '--chart-4': '#9D7F42',
    '--chart-5': '#4F7A96',
  },
  dark: {
    '--font-sans': "'Inter Variable', system-ui, sans-serif",
    '--background': '#1C1B1A',
    '--foreground': '#E6E4DD',
    '--card': '#242321',
    '--card-foreground': '#E6E4DD',
    '--popover': '#242321',
    '--popover-foreground': '#E6E4DD',
    '--muted': '#2C2B29',
    '--muted-foreground': '#8A8780',
    '--border': '#3E3D3A',
    '--input': '#242321',
    '--accent': '#2C2B29',
    '--accent-foreground': '#E6E4DD',
    '--secondary': '#2C2B29',
    '--secondary-foreground': '#E6E4DD',
    '--primary': '#E6E4DD',
    '--primary-foreground': '#1C1B1A',
    '--destructive': '#f87171',
    '--destructive-foreground': '#1C1B1A',
    '--ring': '#8A8780',
    '--radius': '0.5rem',
    '--chart-1': '#DBD9D2',
    '--chart-2': '#CCABA1',
    '--chart-3': '#86977D',
    '--chart-4': '#BF9F68',
    '--chart-5': '#7FA1B7',
  },
};

/** The host's value of a theme variable, or Journal's for the colour scheme when the host has none. */
export function themeToken(style: CSSStyleDeclaration, scheme: 'light' | 'dark', name: string): string {
  return style.getPropertyValue(name).trim() || ((THEME_DEFAULTS[scheme] as Record<string, string>)[name] ?? '');
}
