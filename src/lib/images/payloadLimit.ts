import type { Node } from '@tiptap/pm/model';

/** Homebase refuses a file with more than 25 payloads (HTTP 400 unhandledScenario, #876). */
export const MAX_NOTE_PAYLOADS = 25;

/** Payloads a note's doc needs: its text, plus one per image and per link preview. */
export function countNotePayloads(doc: Node): number {
    let count = 1;
    doc.descendants((node) => {
        if (node.type.name === 'image' || node.type.name === 'linkPreview') count++;
    });
    return count;
}

/** How many more images the note can take before it goes over the limit. */
export const imageRoom = (doc: Node) => Math.max(0, MAX_NOTE_PAYLOADS - countNotePayloads(doc));

export const imageLimitMessage = (room: number) =>
    room === 0
        ? 'This note holds at most 24 images. Split it, or link a new note.'
        : `This note has room for ${room} more ${room === 1 ? 'image' : 'images'}. Split it, or link a new note.`;
