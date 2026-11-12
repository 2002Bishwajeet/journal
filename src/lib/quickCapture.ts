// Desktop quick capture (#1014): the text -> note mapping, and the helpers of the
// Settings -> Shortcuts picker. The hotkey itself is native (native/rust/capture.rs).

export const DEFAULT_CAPTURE_SHORTCUT = 'CmdOrCtrl+Shift+J';

/**
 * First line = title, the rest = body (as the share target does). Null when there is
 * nothing but whitespace, so saving an empty capture does nothing.
 */
export function splitCapture(text: string): { title: string; content: string } | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const newline = trimmed.indexOf('\n');
    if (newline === -1) return { title: trimmed, content: '' };
    return { title: trimmed.slice(0, newline).trim(), content: trimmed.slice(newline + 1).trim() };
}

/** `XDG_SESSION_TYPE` as the native side reports it. Wayland has no global shortcuts (#1094). */
export function isWaylandSession(session: string): boolean {
    return session.toLowerCase() === 'wayland';
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

const NAMED_KEYS: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
};

function keyName(code: string): string | null {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^F\d{1,2}$/.test(code)) return code;
    return NAMED_KEYS[code] ?? null;
}

/**
 * The accelerator string for a key press, e.g. `Ctrl+Shift+J`, or null while the press
 * is only modifiers, has no modifier (a global hotkey on a bare letter would take that
 * key from every app), or is a key the plugin can't name.
 */
export function acceleratorFromEvent(
    e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
    mac: boolean,
): string | null {
    if (MODIFIER_KEYS.has(e.key)) return null;
    const key = keyName(e.code);
    if (!key) return null;
    const parts: string[] = [];
    if (e.metaKey) parts.push(mac ? 'Cmd' : 'Super');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (parts.length === 0) return null;
    return [...parts, key].join('+');
}

/** What the Settings row shows for an accelerator. */
export function displayShortcut(accelerator: string, mac: boolean): string {
    return accelerator
        .replace('CmdOrCtrl', mac ? 'Cmd' : 'Ctrl')
        .replace('Super', mac ? 'Cmd' : 'Win')
        .split('+')
        .join(' + ');
}
