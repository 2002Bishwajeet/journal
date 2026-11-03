/**
 * Saved state for html and react blocks (#410): the block id in the fence's
 * info string, the state map in the note's Yjs doc, the storage bridge the
 * frame talks to, its checks and its write limit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { appendMarkdown, createDoc, replaceInNote, setMarkdown, toMarkdown } from '@/lib/agent/editEngine';
import { buildSrcdoc, FRAME_TOKENS, liveBlockKind, parseCodeInfo, withBlockId, type FrameTheme } from '@/lib/liveBlocks';
import {
  BLOCK_STATE_MAP,
  MAX_BLOCK_STATE_BYTES,
  MAX_NOTE_BLOCK_STATE_BYTES,
  blockStateRoom,
  createBlockStateSession,
  getBlockState,
  getBlockStates,
  getBlockStatesFromBlob,
  memoryBlockStateStore,
  newBlockId,
  ownBlockId,
  replyToStorageMessage,
  setBlockState,
  type BlockStateStore,
} from '@/lib/liveBlockState';
import { COVER_MAP } from '@/lib/editor/cover';
import { getSchema, type JSONContent } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';

const { saveDocumentUpdate } = vi.hoisted(() => ({ saveDocumentUpdate: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({
  getAllFolders: vi.fn().mockResolvedValue([]),
  upsertSyncRecord: vi.fn(),
  saveDocumentUpdate,
  upsertSearchIndex: vi.fn(),
  createFolder: vi.fn(),
}));

import { ImportService } from '@/lib/importexport/ImportService';

const FENCE = '```html id=k3f9\n<p>hi</p>\n```';

describe('parseCodeInfo', () => {
  it('should split the info string into the language and the block id', () => {
    expect(parseCodeInfo('html id=k3f9')).toEqual({ language: 'html', id: 'k3f9', wide: false });
    expect(parseCodeInfo('react   other id=abcdef123456 ')).toEqual({ language: 'react', id: 'abcdef123456', wide: false });
  });

  it('should give no id when there is none, or it is not 4–12 of a-z0-9', () => {
    expect(parseCodeInfo('html')).toEqual({ language: 'html', id: null, wide: false });
    expect(parseCodeInfo(null)).toEqual({ language: null, id: null, wide: false });
    expect(parseCodeInfo('')).toEqual({ language: null, id: null, wide: false });
    for (const bad of ['id=abc', 'id=abcdefghijklm', 'id=K3F9', 'id=k3-f9', 'id=', 'xid=k3f9', 'id=k3f9;']) {
      expect(parseCodeInfo(`html ${bad}`).id).toBeNull();
    }
  });

  it('should not take the language word itself as an id', () => {
    expect(parseCodeInfo('id=k3f9')).toEqual({ language: 'id=k3f9', id: null, wide: false });
  });

  it('should read `wide` as a word of its own, before or after the id (#557)', () => {
    expect(parseCodeInfo('react wide id=k3f9')).toEqual({ language: 'react', id: 'k3f9', wide: true });
    expect(parseCodeInfo('html id=k3f9 wide')).toEqual({ language: 'html', id: 'k3f9', wide: true });
    for (const notWide of ['wide', 'html wider', 'html id=wide', 'html Wide']) expect(parseCodeInfo(notWide).wide).toBe(false);
    expect(liveBlockKind('react wide')).toBe('react');
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
    expect(parseCodeInfo(withBlockId(' html ', id))).toEqual({ language: 'html', id, wide: false });
    expect(parseCodeInfo(withBlockId('react wide', id))).toEqual({ language: 'react', id, wide: true });
  });

  it('should put a new id in place of the one a copied block had (#950)', () => {
    expect(withBlockId('html id=k3f9', 'abcd1234')).toBe('html id=abcd1234');
    expect(withBlockId('react id=k3f9 wide', 'abcd1234')).toBe('react wide id=abcd1234');
  });
});

describe('a block id two blocks in a note have (#950)', () => {
  const schema = getSchema(createBaseExtensions());
  const code = (language: string): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: '<p>hi</p>' }] });
  /** The id each code block in the note owns, in order. */
  const ownIds = (content: JSONContent[]) => {
    const doc = schema.nodeFromJSON({ type: 'doc', content });
    const ids: (string | null)[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') ids.push(ownBlockId(doc, pos));
    });
    return ids;
  };

  it('should belong to the first of them only: a copy has no id of its own', () => {
    expect(ownIds([code('html id=k3f9'), { type: 'paragraph' }, code('react id=k3f9'), code('html'), code('html id=abcd')])).toEqual(['k3f9', null, null, 'abcd']);
  });

  it('should belong to the first in the note, also when it is nested in another block', () => {
    expect(ownIds([{ type: 'blockquote', content: [code('html id=k3f9')] }, code('html id=k3f9')])).toEqual(['k3f9', null]);
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

  it('should keep `wide` through get_note and update_note, as the info string it is in (#557)', () => {
    // As the editor has it: the whole info string in the code block's language.
    const doc = new Y.Doc();
    const code = new Y.XmlElement('codeBlock');
    code.setAttribute('language', 'react wide id=k3f9');
    code.insert(0, [new Y.XmlText('function App() { return null; }')]);
    doc.getXmlFragment('prosemirror').push([code]);

    const markdown = toMarkdown(doc);
    expect(markdown).toContain('```react wide id=k3f9\n');
    setMarkdown(doc, `${markdown}\nA new paragraph.\n`);
    const block = doc
      .getXmlFragment('prosemirror')
      .toArray()
      .find((node): node is Y.XmlElement => node instanceof Y.XmlElement && node.nodeName === 'codeBlock');
    expect(block?.getAttribute('language')).toBe('react wide id=k3f9');
    expect(toMarkdown(doc)).toContain('```react wide id=k3f9\n');
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

  it("should refuse a block's state that takes the note's blocks over 256 KB together, and write nothing (#950)", () => {
    const doc = new Y.Doc();
    // JSON of exactly `bytes` bytes.
    const sized = (bytes: number) => JSON.stringify({ v: 'x'.repeat(bytes - 8) });
    for (const id of ['aaaa', 'bbbb', 'cccc', 'dddd']) setBlockState(doc, id, sized(60_000));
    const left = MAX_NOTE_BLOCK_STATE_BYTES - 240_000;
    expect(blockStateRoom(doc, null)).toBe(left);
    // Another block may save only what is left, though that is under 64 KB.
    expect(() => setBlockState(doc, 'eeee', sized(left + 1))).toThrow();
    expect(getBlockState(doc, 'eeee')).toBeUndefined();
    setBlockState(doc, 'eeee', sized(left));
    expect(blockStateRoom(doc, null)).toBe(0);
    // A block's own state doesn't count against it: it may still change it.
    expect(blockStateRoom(doc, 'aaaa')).toBe(60_000);
    setBlockState(doc, 'aaaa', sized(50_000));
    expect(blockStateRoom(doc, 'aaaa')).toBe(60_000);
    expect(Object.keys(getBlockStates(doc))).toHaveLength(5);
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
  const store: BlockStateStore = {
    read: () => getBlockState(doc, id),
    write: (json) => setBlockState(doc, id, json),
    room: () => blockStateRoom(doc, id),
  };
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

  it("should reject a value that takes the note's blocks over 256 KB together, and keep what it had (#950)", () => {
    vi.useFakeTimers();
    const { doc, store } = docStore();
    for (const id of ['aaaa', 'bbbb', 'cccc', 'dddd']) setBlockState(doc, id, JSON.stringify({ v: 'x'.repeat(60_000) }));
    const session = sessionOn(store);
    expect(session.set('small', 1)).toEqual({});
    // Under 64 KB, but over what the other blocks leave.
    expect(session.set('big', 'x'.repeat(30_000))).toEqual({ error: expect.stringMatching(/256 KB/) });
    vi.advanceTimersByTime(5000);
    expect(getBlockState(doc, 'k3f9')).toBe('{"small":1}');
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
    expect(replyToStorageMessage(request('get', 'secret', undefined, 7), a.session, a.store)).toEqual({
      journalLiveBlock: 1,
      reply: 7,
      value: 'A',
    });
  });

  it("should never let block A read or write block B's state", () => {
    vi.useFakeTimers();
    const { a, b } = twoBlocks();
    // A's port leads to A's session and store: writing through it changes only its own state.
    replyToStorageMessage(request('set', 'secret', 'from A'), a.session, a.store);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(getBlockState(a.doc, 'aaaa')).toBe('{"secret":"from A"}');
    expect(getBlockState(b.doc, 'bbbb')).toBe('{"secret":"B"}');
    expect(b.updates()).toBe(1);
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
      expect(replyToStorageMessage(data, a.session, a.store)).toBeNull();
    }
  });

  it('should answer a bad request with an error', () => {
    const { a } = twoBlocks();
    expect(replyToStorageMessage(request('set', 'k', undefined, 3), a.session, a.store)).toEqual({
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

  /** Runs the injected script with a stand-in parent window and channel, as the frame would. */
  function runFrameScript() {
    const script = buildSrcdoc('', THEME, 'the-token').match(/<script>(\(function \(\) \{[^]*?)<\/script>/)![1];
    const posted: Record<string, unknown>[] = [];
    const port: { postMessage(message: Record<string, unknown>): void; onmessage?: (event: { data: unknown }) => void } = {
      postMessage: (message) => posted.push(message),
    };
    const port2 = {};
    class MessageChannel {
      port1 = port;
      port2 = port2;
    }
    const handedOver: unknown[][] = [];
    const parent = { postMessage: (...args: unknown[]) => handedOver.push(args) };
    const removeScript = vi.fn();
    const frameWindow: { journal?: { storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> } } } = {};
    new Function('window', 'parent', 'document', 'addEventListener', 'MessageChannel', script)(frameWindow, parent, { currentScript: { remove: removeScript } }, () => {}, MessageChannel);
    return { storage: frameWindow.journal!.storage, posted, handedOver, port2, removeScript, deliver: (data: unknown) => port.onmessage!({ data }) };
  }

  it('should come before the source, so the source can use it as it loads', () => {
    const srcdoc = buildSrcdoc('<p>block</p>', THEME, 'the-token');
    expect(srcdoc.indexOf('window.journal')).toBeLessThan(srcdoc.indexOf('<p>block</p>'));
  });

  it('should hand the app one end of a channel as it starts, and leave the document', () => {
    const { handedOver, port2, removeScript } = runFrameScript();
    expect(handedOver).toEqual([[{ journalLiveBlock: 1, bridge: 'the-token' }, '*', [port2]]]);
    expect(removeScript).toHaveBeenCalledOnce();
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

  it('should ignore a message that is no reply to a request', async () => {
    const { storage, deliver } = runFrameScript();
    const get = storage.get('count');
    deliver({ journalLiveBlock: 1, reply: 2, value: 'not asked for' });
    deliver(null);
    deliver({ journalLiveBlock: 1, reply: 1, value: 3 });
    await expect(get).resolves.toBe(3);
  });
});
