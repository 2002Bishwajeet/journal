/**
 * Saved state of html and react blocks (#410). It lives in the note's Yjs doc, in
 * a map of its own keyed by the block id from the fence's info string
 * (```html id=k3f9), so it syncs with the note. A block reaches it only through
 * `journal.storage` in its frame, which asks the app over the #412 bridge; the
 * frame is untrusted, so every check and limit is in the app (the session in
 * @journal/live-blocks, and the note's limit here).
 */
import * as Y from 'yjs';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getNewId } from '@/lib/utils';
import { MAX_BLOCK_STATE_BYTES, parseCodeInfo } from '@journal/live-blocks/core';

/** Y.Map in the note's Yjs doc: block id -> the block's whole state as one JSON text. */
export const BLOCK_STATE_MAP = 'liveBlockState';
/** The most a note's blocks may save together, so many blocks can't bloat the note and its versions (#950). */
export const MAX_NOTE_BLOCK_STATE_BYTES = 256 * 1024;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** A block's saved state as JSON text, or undefined when it has none. */
export function getBlockState(ydoc: Y.Doc, id: string): string | undefined {
  const value = ydoc.getMap(BLOCK_STATE_MAP).get(id);
  return typeof value === 'string' ? value : undefined;
}

/** The most block `id` (null: a block with no id yet) may save now: 64 KB, or what the note's other blocks leave of 256 KB. */
export function blockStateRoom(ydoc: Y.Doc, id: string | null): number {
  let others = 0;
  ydoc.getMap(BLOCK_STATE_MAP).forEach((value, key) => {
    if (key !== id && typeof value === 'string') others += utf8Length(value);
  });
  return Math.min(MAX_BLOCK_STATE_BYTES, MAX_NOTE_BLOCK_STATE_BYTES - others);
}

export function setBlockState(ydoc: Y.Doc, id: string, json: string): void {
  if (utf8Length(json) > blockStateRoom(ydoc, id)) throw new Error('A block can save at most 64 KB, and a note’s blocks 256 KB together.');
  ydoc.getMap(BLOCK_STATE_MAP).set(id, json);
}

/** Every block's saved state in a doc. */
export function getBlockStates(ydoc: Y.Doc): Record<string, string> {
  const states: Record<string, string> = {};
  ydoc.getMap(BLOCK_STATE_MAP).forEach((value, id) => {
    if (typeof value === 'string') states[id] = value;
  });
  return states;
}

/** Every block's saved state, from a stored Yjs blob: for callers without a live doc. */
export function getBlockStatesFromBlob(yjsBlob: Uint8Array): Record<string, string> {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, yjsBlob);
    return getBlockStates(ydoc);
  } catch {
    return {};
  } finally {
    ydoc.destroy();
  }
}

/**
 * The block id of the code block at `pos` in `doc`, or null when it has none of its
 * own: only the first block in the note with an id owns that id's state, so a copy
 * of it (pasted, or given the same id) neither reads nor writes it (#950).
 */
export function ownBlockId(doc: PMNode, pos: number): string | null {
  const idOf = (node: PMNode | null | undefined) => parseCodeInfo((node?.attrs.language as string | null) ?? null).id;
  const id = idOf(doc.nodeAt(pos));
  if (!id) return null;
  let first: number | undefined;
  doc.descendants((node, at) => {
    if (first === undefined && node.type.name === 'codeBlock' && idOf(node) === id) first = at;
    return first === undefined;
  });
  return first === pos ? id : null;
}

/** A fresh block id: 8 characters of a-z0-9, which parseCodeInfo accepts. */
export function newBlockId(): string {
  return getNewId().replace(/-/g, '').slice(0, 8).toLowerCase();
}
