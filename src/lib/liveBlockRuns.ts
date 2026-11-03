/**
 * Click-to-run for html and react blocks someone else may have written (#947). A block
 * runs on its own only in a note the signed-in identity owns and last edited itself.
 * Anywhere else (a note shared with you, the share page, a note an agent or a
 * collaborator edited last) it waits for Run. Code that was run runs on its own after
 * that, on this device, until it changes. The block's id is not part of that: a block
 * gets one the first time it saves its state (#410), and its code is still the same.
 */
import type { DocumentMetadata } from '@/types';
import type { LiveBlockKind } from '@/lib/liveBlocks';
import { LIVE_BLOCK_RUNS_KEY, readJson, writeJson } from '@/lib/storage';

/** The note is the identity's own and no one else (an agent, a collaborator) edited it last. */
export function ownerWroteNote(metadata: Pick<DocumentMetadata, 'authorOdinId' | 'lastEditedBy'>, editorOdinId: string | undefined): boolean {
    const shared = !!metadata.authorOdinId && metadata.authorOdinId !== editorOdinId;
    return !shared && (!metadata.lastEditedBy || metadata.lastEditedBy === editorOdinId);
}

// A SHA-256, so a block's author can't write code that matches code the reader already ran.
async function runKey(kind: LiveBlockKind, source: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}\n${source}`));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function runKeys(): string[] {
    const keys = readJson<unknown>(LIVE_BLOCK_RUNS_KEY);
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
}

/** A block of this kind with this code was run on this device. */
export async function hasRunLiveBlock(kind: LiveBlockKind, source: string): Promise<boolean> {
    return runKeys().includes(await runKey(kind, source));
}

export async function rememberLiveBlockRun(kind: LiveBlockKind, source: string): Promise<void> {
    const key = await runKey(kind, source);
    const keys = runKeys();
    if (!keys.includes(key)) writeJson(LIVE_BLOCK_RUNS_KEY, [...keys, key]);
}
