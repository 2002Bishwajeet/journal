/**
 * Saved state of html and react blocks (#410), as the preview sees it. A block reaches it
 * only through `journal.storage` in its frame, which asks the host over the #412 bridge; the
 * frame is untrusted, so every check and limit is here, in the host. Where the state is kept
 * (Journal: the note's Yjs doc) is the host's `BlockStateStore`.
 */
import { storageRequestFromMessage } from './liveBlocks';

/** The most a block may save: its whole state as JSON, in UTF-8 bytes. */
export const MAX_BLOCK_STATE_BYTES = 64 * 1024;
/** A block's state is written to its store at most this often. */
export const BLOCK_STATE_WRITE_INTERVAL_MS = 1000;
const MAX_KEY_LENGTH = 256;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** Where one block's state is kept: the note (editor), or memory (a share page viewer). */
export interface BlockStateStore {
  read(): string | undefined;
  write(json: string): void;
  /** The most the block may save now, in UTF-8 bytes. */
  room(): number;
}

/** A store in memory only, seeded with `json`: what a share page viewer, or the viewer of a view-only note, writes to. */
export function memoryBlockStateStore(json: string | undefined): BlockStateStore {
  let current = json;
  return {
    read: () => current,
    write: (next) => {
      current = next;
    },
    room: () => MAX_BLOCK_STATE_BYTES,
  };
}

type State = Record<string, unknown>;

function parseState(json: string | undefined): State {
  if (json === undefined) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as State) : {};
  } catch {
    return {};
  }
}

/** Only what JSON.parse can give back: a value posted from a frame can also be a Date, a Map, undefined… */
function isJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isJson);
}

function isSerialisable(value: unknown): boolean {
  try {
    return isJson(value);
  } catch {
    // A cycle overflows the stack.
    return false;
  }
}

const isKey = (key: unknown): key is string => typeof key === 'string' && key.length <= MAX_KEY_LENGTH;
const KEY_ERROR = { error: 'journal.storage: a key is a string of at most 256 characters.' };

export type StorageReply = { value?: unknown } | { error: string };

/**
 * One block's storage, for as long as its preview is shown. `set` changes an
 * in-memory copy at once; the copy goes to the store at most once a second,
 * the latest value each time, and on `flush` (when the preview goes away).
 * Otherwise the state is read from the store, so a change that synced in from
 * another tab or device is seen. Either way it lives in the app, not the frame,
 * so a reload of the frame (the theme changed) keeps it.
 *
 * Each call takes the block's store as it is then (it changes when the block
 * gets its id); the pending copy goes to the store of the latest `set`.
 */
export function createBlockStateSession() {
  // Set, and not written to its store yet.
  let pending: { state: State; json: string; store: BlockStateStore } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = -Infinity;

  const current = (store: BlockStateStore) => pending?.state ?? parseState(store.read());
  const write = () => {
    timer = null;
    if (!pending) return;
    const { json, store } = pending;
    pending = null;
    lastWrite = Date.now();
    store.write(json);
  };

  return {
    get(store: BlockStateStore, key: unknown): StorageReply {
      if (!isKey(key)) return KEY_ERROR;
      const saved = current(store);
      return { value: Object.hasOwn(saved, key) ? saved[key] : undefined };
    },
    set(store: BlockStateStore, key: unknown, value: unknown): StorageReply {
      if (!isKey(key)) return KEY_ERROR;
      if (!isSerialisable(value)) return { error: 'journal.storage: a value must be JSON: a string, a finite number, true, false, null, or an array or plain object of those.' };
      const state = { ...current(store), [key]: value };
      const json = JSON.stringify(state);
      if (utf8Length(json) > store.room()) return { error: 'journal.storage: a block can save at most 64 KB, and a note’s blocks 256 KB together; this value would take it over.' };
      pending = { state, json, store };
      if (!timer) timer = setTimeout(write, Math.max(0, lastWrite + BLOCK_STATE_WRITE_INTERVAL_MS - Date.now()));
      return {};
    },
    flush(): void {
      if (timer) clearTimeout(timer);
      write();
    },
  };
}

export type BlockStateSession = ReturnType<typeof createBlockStateSession>;

/**
 * The reply to send back for a storage request in a message on a block's port,
 * or null when there is none to send: the message is not a request.
 */
export function replyToStorageMessage(message: unknown, session: BlockStateSession, store: BlockStateStore) {
  const request = storageRequestFromMessage(message);
  if (!request) return null;
  const answer = request.storage === 'get' ? session.get(store, request.key) : session.set(store, request.key, request.value);
  return { journalLiveBlock: 1, reply: request.request, ...answer };
}
