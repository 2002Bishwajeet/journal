/**
 * Saved state for html and react blocks (#410): the block id in the fence's
 * info string, the state map in the note's Yjs doc, the storage bridge the
 * frame talks to, its checks and its write limit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { appendMarkdown, createDoc, replaceInNote, toMarkdown } from '@/lib/agent/editEngine';
import { buildSrcdoc, FRAME_TOKENS, liveBlockKind, parseCodeInfo, withBlockId, type FrameTheme } from '@/lib/liveBlocks';
import {
  BLOCK_STATE_MAP,
  MAX_BLOCK_STATE_BYTES,
  createBlockStateSession,
  getBlockState,
  getBlockStatesFromBlob,
  memoryBlockStateStore,
  newBlockId,
  replyToStorageMessage,
  setBlockState,
  type BlockStateStore,
} from '@/lib/liveBlockState';
import { COVER_MAP } from '@/lib/editor/cover';

const { saveDocumentUpdate } = vi.hoisted(() => ({ saveDocumentUpdate: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({
  getAllFolders: vi.fn().mockResolvedValue([]),
  saveDocumentUpdate,
  upsertSearchIndex: vi.fn(),
  createFolder: vi.fn(),
}));

import { ImportService } from '@/lib/importexport/ImportService';

const FENCE = '```html id=k3f9\n<p>hi</p>\n```';

describe('parseCodeInfo', () => {
  it('should split the info string into the language and the block id', () => {
    expect(parseCodeInfo('html id=k3f9')).toEqual({ language: 'html', id: 'k3f9' });
    expect(parseCodeInfo('react   other id=abcdef123456 ')).toEqual({ language: 'react', id: 'abcdef123456' });
  });

  it('should give no id when there is none, or it is not 4–12 of a-z0-9', () => {
    expect(parseCodeInfo('html')).toEqual({ language: 'html', id: null });
    expect(parseCodeInfo(null)).toEqual({ language: null, id: null });
    expect(parseCodeInfo('')).toEqual({ language: null, id: null });
    for (const bad of ['id=abc', 'id=abcdefghijklm', 'id=K3F9', 'id=k3-f9', 'id=', 'xid=k3f9', 'id=k3f9;']) {
      expect(parseCodeInfo(`html ${bad}`).id).toBeNull();
    }
  });

  it('should not take the language word itself as an id', () => {
    expect(parseCodeInfo('id=k3f9')).toEqual({ language: 'id=k3f9', id: null });
  });

  it('should make a block with an id in its info string a live block of its language', () => {
    expect(liveBlockKind('html id=k3f9')).toBe('html');
    expect(liveBlockKind('React id=abcd')).toBe('react');
    expect(liveBlockKind('js id=k3f9')).toBeNull();
  });

  it('should add an id that parses back', () => {
    const id = newBlockId();
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(withBlockId('html', id)).toBe(`html id=${id}`);
    expect(parseCodeInfo(withBlockId(' html ', id))).toEqual({ language: 'html', id });
  });
});

describe('the block id in markdown', () => {
  it('should survive createDoc and toMarkdown unchanged', () => {
    expect(toMarkdown(createDoc(`${FENCE}\n`)).trim()).toBe(FENCE);
  });

  it('should survive replace_in_note inside the block, and the state stays linked to it', () => {
    const doc = createDoc(`Intro\n\n${FENCE}\n`);
    setBlockState(doc, 'k3f9', '{"count":3}');
    replaceInNote(doc, '<p>hi</p>', '<p>bye</p>');
    expect(toMarkdown(doc)).toContain('```html id=k3f9\n<p>bye</p>\n```');
    expect(getBlockState(doc, 'k3f9')).toBe('{"count":3}');
  });

  it('should survive append_to_note elsewhere in the note', () => {
    const doc = createDoc(`${FENCE}\n`);
    appendMarkdown(doc, 'A new paragraph.');
    expect(toMarkdown(doc)).toContain(FENCE);
    expect(toMarkdown(doc)).toContain('A new paragraph.');
  });

  it('should survive a markdown import, which parses it into real blocks', async () => {
    saveDocumentUpdate.mockClear();
    const result = await ImportService.importFiles([new File([`# Note\n\n${FENCE}\n`], 'note.md', { type: 'text/markdown' })]);
    expect(result.imported).toBe(1);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saveDocumentUpdate.mock.calls[0][1] as Uint8Array);
    expect(toMarkdown(doc)).toContain(FENCE);
  });
});

describe('the state map', () => {
  it('should keep each block’s JSON under its id, in a map of its own', () => {
    expect(BLOCK_STATE_MAP).not.toBe(COVER_MAP);
    const doc = new Y.Doc();
    setBlockState(doc, 'k3f9', '{"count":3}');
    setBlockState(doc, 'abcd', '{"x":1}');
    expect(getBlockState(doc, 'k3f9')).toBe('{"count":3}');
    expect(getBlockState(doc, 'none')).toBeUndefined();
    expect(getBlockStatesFromBlob(Y.encodeStateAsUpdate(doc))).toEqual({ k3f9: '{"count":3}', abcd: '{"x":1}' });
  });

  it('should sync with the note to another device', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setBlockState(a, 'k3f9', '{"count":3}');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(getBlockState(b, 'k3f9')).toBe('{"count":3}');
  });

  it('should refuse more than 64 KB and write nothing', () => {
    const doc = new Y.Doc();
    expect(() => setBlockState(doc, 'k3f9', JSON.stringify({ a: 'x'.repeat(MAX_BLOCK_STATE_BYTES) }))).toThrow();
    expect(getBlockState(doc, 'k3f9')).toBeUndefined();
  });

  it('should read nothing from bytes that are not a Yjs update', () => {
    expect(getBlockStatesFromBlob(new Uint8Array([1, 2, 3, 4]))).toEqual({});
  });
});

/** A store in a Y.Doc, counting the Yjs updates it makes. */
function docStore(id = 'k3f9') {
  const doc = new Y.Doc();
  let updates = 0;
  doc.on('update', () => updates++);
  const store: BlockStateStore = { read: () => getBlockState(doc, id), write: (json) => setBlockState(doc, id, json) };
  return { doc, store, updates: () => updates };
}

/** A session whose every call is on `store`, as a mounted block's are. */
function sessionOn(store: BlockStateStore) {
  const session = createBlockStateSession();
  return { get: (key: unknown) => session.get(store, key), set: (key: unknown, value: unknown) => session.set(store, key, value), flush: session.flush };
}

describe('a block’s storage session', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should give back what was set, at once, and undefined for a key never set', () => {
    const session = sessionOn(memoryBlockStateStore(undefined));
    expect(session.get('count')).toEqual({ value: undefined });
    expect(session.set('count', 3)).toEqual({});
    expect(session.get('count')).toEqual({ value: 3 });
  });

  it('should start from the saved state, and save it to the store', () => {
    vi.useFakeTimers();
    const { doc, store } = docStore();
    setBlockState(doc, 'k3f9', '{"count":3}');
    const session = sessionOn(store);
    expect(session.get('count')).toEqual({ value: 3 });
    session.set('name', { first: 'Ada', tags: ['a', null, true, 1.5] });
    vi.advanceTimersByTime(0);
    expect(JSON.parse(getBlockState(doc, 'k3f9')!)).toEqual({ count: 3, name: { first: 'Ada', tags: ['a', null, true, 1.5] } });
    // A new session (the note opened again) reads it back.
    expect(sessionOn(store).get('name')).toEqual({ value: { first: 'Ada', tags: ['a', null, true, 1.5] } });
  });

  it('should see a change that synced in from another tab or device', () => {
    const { doc, store } = docStore();
    const session = sessionOn(store);
    expect(session.get('count')).toEqual({ value: undefined });
    const other = new Y.Doc();
    setBlockState(other, 'k3f9', '{"count":7}');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    expect(session.get('count')).toEqual({ value: 7 });
  });

  it('should not give an inherited property for a key', () => {
    const session = sessionOn(memoryBlockStateStore('{}'));
    expect(session.get('constructor')).toEqual({ value: undefined });
    expect(session.get('__proto__')).toEqual({ value: undefined });
  });

  it('should reject a value that is not JSON, and write nothing', () => {
    vi.useFakeTimers();
    const { store, updates } = docStore();
    const session = sessionOn(store);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [undefined, NaN, Infinity, new Date(), new Map(), () => 1, cyclic, [1, undefined], { a: new Set() }, 10n]) {
      const reply = session.set('k', value);
      expect(reply).toEqual({ error: expect.stringMatching(/must be JSON/) });
    }
    vi.advanceTimersByTime(5000);
    expect(updates()).toBe(0);
    expect(session.get('k')).toEqual({ value: undefined });
  });

  it('should reject a key that is not a string of at most 256 characters', () => {
    const session = sessionOn(memoryBlockStateStore(undefined));
    for (const key of [1, null, undefined, {}, 'k'.repeat(257)]) {
      expect(session.set(key, 1)).toEqual({ error: expect.stringMatching(/key/) });
      expect(session.get(key)).toEqual({ error: expect.stringMatching(/key/) });
    }
    expect(session.set('k'.repeat(256), 1)).toEqual({});
  });

  it('should reject a value that takes the block over 64 KB, and keep what it had', () => {
    vi.useFakeTimers();
    const { doc, store } = docStore();
    const session = sessionOn(store);
    session.set('small', 1);
    vi.advanceTimersByTime(0);
    // UTF-8: 3 bytes a character, so 22,000 of them are over 64 KB though the string is shorter.
    expect(session.set('big', '€'.repeat(22_000))).toEqual({ error: expect.stringMatching(/64 KB/) });
    vi.advanceTimersByTime(5000);
    expect(getBlockState(doc, 'k3f9')).toBe('{"small":1}');
    expect(session.get('big')).toEqual({ value: undefined });
  });

  it('should make at most one Yjs update a second, with the latest value, from a set in a tight loop', () => {
    vi.useFakeTimers();
    const { doc, store, updates } = docStore();
    const times: number[] = [];
    doc.on('update', () => times.push(Date.now()));
    const session = sessionOn(store);

    // Five seconds of a set every 10ms.
    let n = 0;
    for (let ms = 0; ms < 5000; ms += 10) {
      session.set('n', ++n);
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(1000);
    expect(times.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
    expect(getBlockState(doc, 'k3f9')).toBe(`{"n":${n}}`);
    // 500 sets over five seconds: one write a second at most, the first at once.
    expect(updates()).toBeLessThanOrEqual(6);
  });

  it('should write a pending value at once on flush (the block goes away)', () => {
    vi.useFakeTimers();
    const { doc, store } = docStore();
    const session = sessionOn(store);
    session.set('n', 1);
    vi.advanceTimersByTime(0);
    session.set('n', 2);
    expect(getBlockState(doc, 'k3f9')).toBe('{"n":1}');
    session.flush();
    expect(getBlockState(doc, 'k3f9')).toBe('{"n":2}');
  });
});

describe('the storage bridge', () => {
  // Stand-ins for windows: only their identity matters.
  const frameA = {} as Window;
  const frameB = {} as Window;
  const otherWindow = {} as Window;
  const request = (storage: 'get' | 'set', key: string, value?: unknown, n = 1) => ({ journalLiveBlock: 1, storage, request: n, key, value });

  const twoBlocks = () => {
    const a = docStore('aaaa');
    const b = docStore('bbbb');
    setBlockState(a.doc, 'aaaa', '{"secret":"A"}');
    setBlockState(b.doc, 'bbbb', '{"secret":"B"}');
    return { a: { ...a, session: createBlockStateSession() }, b: { ...b, session: createBlockStateSession() } };
  };

  it("should answer a block's request from its own state, by the request's number", () => {
    const { a } = twoBlocks();
    expect(replyToStorageMessage({ source: frameA, data: request('get', 'secret', undefined, 7) }, frameA, a.session, a.store)).toEqual({
      journalLiveBlock: 1,
      reply: 7,
      value: 'A',
    });
  });

  it("should never let block A read or write block B's state", () => {
    vi.useFakeTimers();
    const { a, b } = twoBlocks();
    // A's frame posting to B's listener is no request of B's: no reply, nothing read or written.
    expect(replyToStorageMessage({ source: frameA, data: request('get', 'secret') }, frameB, b.session, b.store)).toBeNull();
    expect(replyToStorageMessage({ source: frameA, data: request('set', 'secret', 'from A') }, frameB, b.session, b.store)).toBeNull();
    // A writing through its own bridge changes only its own state.
    replyToStorageMessage({ source: frameA, data: request('set', 'secret', 'from A') }, frameA, a.session, a.store);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(getBlockState(a.doc, 'aaaa')).toBe('{"secret":"from A"}');
    expect(getBlockState(b.doc, 'bbbb')).toBe('{"secret":"B"}');
    expect(b.updates()).toBe(1);
  });

  it('should not reply to a message from a window that is not a known frame', () => {
    const { a } = twoBlocks();
    for (const source of [otherWindow, null]) {
      expect(replyToStorageMessage({ source, data: request('get', 'secret') }, frameA, a.session, a.store)).toBeNull();
    }
    expect(replyToStorageMessage({ source: frameA, data: request('get', 'secret') }, null, a.session, a.store)).toBeNull();
  });

  it('should not take a height report, or anything without the marker, op and number, as a request', () => {
    const { a } = twoBlocks();
    for (const data of [
      { journalLiveBlock: 1, height: 900 },
      { journalLiveBlock: '1', storage: 'get', request: 1, key: 'secret' },
      { journalLiveBlock: 1, storage: 'delete', request: 1, key: 'secret' },
      { journalLiveBlock: 1, storage: 'get', request: '1', key: 'secret' },
      { journalLiveBlock: 1, storage: 'get', request: NaN, key: 'secret' },
      null,
      'get',
    ]) {
      expect(replyToStorageMessage({ source: frameA, data }, frameA, a.session, a.store)).toBeNull();
    }
  });

  it('should answer a bad request with an error', () => {
    const { a } = twoBlocks();
    expect(replyToStorageMessage({ source: frameA, data: request('set', 'k', undefined, 3) }, frameA, a.session, a.store)).toEqual({
      journalLiveBlock: 1,
      reply: 3,
      error: expect.stringMatching(/must be JSON/),
    });
  });
});

describe('journal.storage in the frame', () => {
  const THEME: FrameTheme = {
    colorScheme: 'light',
    tokens: Object.fromEntries(FRAME_TOKENS.map((name) => [name, '#000'])) as FrameTheme['tokens'],
    fontFamily: 'system-ui',
    lineHeight: '1.5',
  };

  /** Runs the injected script with a stand-in parent window, as the frame would. */
  function runFrameScript() {
    const script = buildSrcdoc('', THEME).match(/<script>(\(function \(\) \{var next[^]*?)<\/script>/)![1];
    const posted: Record<string, unknown>[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => posted.push(message) };
    const frameWindow: { journal?: { storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> } } } = {};
    let onMessage: (event: { source: unknown; data: unknown }) => void = () => {};
    new Function('window', 'parent', 'addEventListener', script)(frameWindow, parent, (_: string, listener: typeof onMessage) => {
      onMessage = listener;
    });
    return { storage: frameWindow.journal!.storage, posted, parent, deliver: (data: unknown, source: unknown = parent) => onMessage({ data, source }) };
  }

  it('should come before the source, so the source can use it as it loads', () => {
    const srcdoc = buildSrcdoc('<p>block</p>', THEME);
    expect(srcdoc.indexOf('window.journal')).toBeLessThan(srcdoc.indexOf('<p>block</p>'));
  });

  it('should post get and set to the app and resolve with the reply to the same request', async () => {
    const { storage, posted, deliver } = runFrameScript();
    const first = storage.get('count');
    const second = storage.set('count', 3);
    expect(posted).toEqual([
      { journalLiveBlock: 1, storage: 'get', request: 1, key: 'count', value: undefined },
      { journalLiveBlock: 1, storage: 'set', request: 2, key: 'count', value: 3 },
    ]);
    deliver({ journalLiveBlock: 1, reply: 2 });
    deliver({ journalLiveBlock: 1, reply: 1, value: 3 });
    await expect(first).resolves.toBe(3);
    await expect(second).resolves.toBeUndefined();
  });

  it('should reject on an error reply', async () => {
    const { storage, deliver } = runFrameScript();
    const set = storage.set('big', 'x');
    deliver({ journalLiveBlock: 1, reply: 1, error: 'journal.storage: a block can save at most 64 KB' });
    await expect(set).rejects.toThrow('64 KB');
  });

  it('should ignore a reply from anything but the app', async () => {
    const { storage, deliver } = runFrameScript();
    const get = storage.get('count');
    deliver({ journalLiveBlock: 1, reply: 1, value: 'forged' }, {});
    deliver(null);
    deliver({ journalLiveBlock: 1, reply: 1, value: 3 });
    await expect(get).resolves.toBe(3);
  });
});
