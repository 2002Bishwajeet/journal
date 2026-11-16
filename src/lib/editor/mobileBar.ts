import { AllSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';

/** Which bar the phone editor shows above the keyboard (#1272). */
export type MobileBar = 'insert' | 'format';

/**
 * A non-empty text selection gets the format bar. A caret, a node selection (image, live
 * block), a table cell selection and text inside a code block, where marks do not apply,
 * keep the insert bar.
 */
export function getMobileBar(selection: Selection): MobileBar {
    const isText = selection instanceof TextSelection || selection instanceof AllSelection;
    if (!isText || selection.empty) return 'insert';
    return selection.$from.parent.type.spec.code ? 'insert' : 'format';
}

/** Below this the "keyboard" is only a shortcut bar (a hardware keyboard on an iPad). */
const MIN_PANEL_HEIGHT = 200;

/**
 * Height in px for the Aa style panel, which stands in for the keyboard: the keyboard's own
 * height, or null when it is unknown (Android resizes the layout, so the offset is 0) and the
 * panel takes its content's height, as a bottom sheet.
 */
export function getStylePanelHeight(keyboardOffset: number): number | null {
    return keyboardOffset >= MIN_PANEL_HEIGHT ? keyboardOffset : null;
}

export const MAX_INDENT = 8;

/**
 * Moves the paragraphs and headings in the selection one indent step in (`1`) or out (`-1`),
 * between 0 and MAX_INDENT. Returns whether any block changed.
 */
export function shiftIndent(tr: Transaction, delta: 1 | -1): boolean {
    const { from, to } = tr.selection;
    let changed = false;
    tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
        const current = Number(node.attrs.indent ?? 0);
        const indent = Math.min(MAX_INDENT, Math.max(0, current + delta));
        if (indent !== current) {
            tr.setNodeAttribute(pos, 'indent', indent);
            changed = true;
        }
        return false;
    });
    return changed;
}

/** A touch held this long (ms) without moving selects the word under it, like Apple Notes (#1272). */
export const LONG_PRESS_MS = 500;
/** Movement (px) past which a press is a caret drag (the native loupe), not a long press. */
export const LONG_PRESS_SLOP = 10;

/** Whether a touch that lasted `duration` ms and strayed at most `distance` px is a stationary long press. */
export function isLongPress(duration: number, distance: number): boolean {
    return duration >= LONG_PRESS_MS && distance <= LONG_PRESS_SLOP;
}

/**
 * The word at `offset` in `text` as [from, to], or null off a word. A press on the right half
 * of a word's last letter lands just after it, so the character before `offset` counts too.
 */
export function getWordAt(text: string, offset: number): [number, number] | null {
    const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text);
    for (const at of [offset, offset - 1]) {
        const hit = at >= 0 && at < text.length ? segments.containing(at) : undefined;
        if (hit?.isWordLike) return [hit.index, hit.index + hit.segment.length];
    }
    return null;
}
