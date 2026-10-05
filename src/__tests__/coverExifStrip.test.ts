// @vitest-environment happy-dom
/**
 * Cover uploads are served anonymously on public notes, so they must go through
 * image ingest (EXIF/GPS stripped, downscaled) before anything is queued.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement as h, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EditorProvider } from '@/components/editor/EditorProvider';
import { useEditorContext } from '@/components/editor/EditorContext';
import { planImageIngest, prepareImageForUpload, MAX_EDGE, QUALITY } from '@/lib/images/imageIngest';
import type { DocumentMetadata } from '@/types';

const savePendingImageUpload = vi.fn();

vi.mock('@/hooks/useAISettings', () => ({
  useAISettings: () => ({ settings: { grammarEnabled: false } }),
}));
vi.mock('@/lib/yjs', () => ({
  PGliteProvider: class {
    load() {
      return new Promise(() => {});
    }
  },
}));
vi.mock('@/lib/yjs/flushPendingSave', () => ({ flushPendingSaveOnTeardown: vi.fn() }));
vi.mock('@/lib/db', () => ({
  upsertSearchIndex: vi.fn(),
  savePendingImageUpload: (...args: unknown[]) => savePendingImageUpload(...args),
  savePendingImageDeletion: vi.fn(),
  updateSyncStatus: vi.fn(),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: vi.fn(async () => {}) }) }));
vi.mock('@/hooks/useNoteTitleMap', () => ({
  useNoteTitleMap: () => ({ map: new Map(), isReady: true }),
}));
vi.mock('@/lib/notes/createNote', () => ({ createNoteWithContentInDb: vi.fn() }));
vi.mock('@/hooks/useDocumentSubscription', () => ({ useDocumentSubscription: vi.fn() }));
vi.mock('@/components/editor/hooks/useImageDeletionTracker', () => ({
  useImageDeletionTracker: vi.fn(),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const metadata = {
  title: 'Note',
  folderId: 'folder',
  tags: [],
  timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
  excludeFromAI: false,
} as unknown as DocumentMetadata;

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A JPEG whose APP1 segment is real Exif with a GPS IFD pointer (tag 0x8825). */
function jpegWithGps(): Uint8Array<ArrayBuffer> {
  const tiff = [
    ...ascii('II'), 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // header, IFD0 at 8
    0x01, 0x00, // 1 entry
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, // GPSInfo pointer
    0x00, 0x00, 0x00, 0x00, // next IFD
    0x00, 0x00, // GPS IFD: 0 entries
  ];
  const payload = [...ascii('Exif'), 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xd9]);
}

const hasExifSegment = (bytes: Uint8Array) => {
  for (let i = 0; i < bytes.length - 9; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe1 && ascii('Exif').every((c, k) => bytes[i + 4 + k] === c)) return true;
  }
  return false;
};

// What the canvas encoder outputs: no EXIF at all.
const CLEAN_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const CLEAN_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function stubDecode(width: number, height: number) {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap));
}

function stubCanvas() {
  const convertToBlob = vi.fn(async ({ type }: { type: string }) =>
    new Blob([type === 'image/png' ? CLEAN_PNG : CLEAN_JPEG], { type }));
  const drawImage = vi.fn();
  class FakeOffscreenCanvas {
    convertToBlob = convertToBlob;
    getContext() {
      return { drawImage };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return { convertToBlob, drawImage };
}

type Ctx = ReturnType<typeof useEditorContext>;

async function mountProvider() {
  const ref: { ctx?: Ctx } = {};
  function Capture() {
    const ctx = useEditorContext();
    useEffect(() => {
      ref.ctx = ctx;
    });
    ref.ctx = ctx;
    return null;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  root.render(h(MemoryRouter, null, h(EditorProvider, { docId: 'doc-1', metadata, children: h(Capture) })));
  await new Promise((r) => setTimeout(r, 100));
  return { ref, cleanup: () => { root.unmount(); el.remove(); } };
}

describe('setCoverFromFile — EXIF stripping', () => {
  let cleanup: () => void;
  let ref: { ctx?: Ctx };

  beforeEach(async () => {
    savePendingImageUpload.mockReset();
    savePendingImageUpload.mockResolvedValue(undefined);
    URL.createObjectURL = vi.fn(() => 'blob:cover');
    ({ ref, cleanup } = await mountProvider());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('queues a GPS-tagged JPEG cover without its EXIF, never the original bytes', async () => {
    const original = jpegWithGps();
    expect(hasExifSegment(original)).toBe(true);
    stubDecode(800, 600);
    stubCanvas();
    const file = new File([original], 'trip.jpg', { type: 'image/jpeg' });

    await ref.ctx!.setCoverFromFile(file);

    expect(savePendingImageUpload).toHaveBeenCalledTimes(1);
    const queued = savePendingImageUpload.mock.calls[0][0] as { blobData: Uint8Array; contentType: string };
    expect(hasExifSegment(queued.blobData)).toBe(false);
    expect(new TextDecoder('latin1').decode(queued.blobData)).not.toContain('Exif');
    expect(Array.from(queued.blobData)).toEqual(Array.from(CLEAN_JPEG));
    expect(queued.contentType).toBe('image/jpeg');
  });

  it('re-encodes a small PNG cover instead of passing it through', async () => {
    stubDecode(800, 600);
    const { convertToBlob } = stubCanvas();
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'small.png', { type: 'image/png' });

    await ref.ctx!.setCoverFromFile(file);

    expect(convertToBlob).toHaveBeenCalled();
    const queued = savePendingImageUpload.mock.calls[0][0] as { blobData: Uint8Array; contentType: string };
    expect(Array.from(queued.blobData)).toEqual(Array.from(CLEAN_PNG));
    expect(queued.contentType).toBe('image/png');
  });

  it('downscales an oversize cover to MAX_EDGE at the unchanged QUALITY', async () => {
    stubDecode(MAX_EDGE * 2, MAX_EDGE);
    const { convertToBlob, drawImage } = stubCanvas();
    const file = new File([jpegWithGps()], 'big.jpg', { type: 'image/jpeg' });

    await ref.ctx!.setCoverFromFile(file);

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_EDGE, MAX_EDGE / 2);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.85 });
    expect(QUALITY).toBe(0.85);
  });

  it('leaves the cover unset and queues nothing when ingest fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('corrupt'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = new File([jpegWithGps()], 'bad.jpg', { type: 'image/jpeg' });

    await expect(ref.ctx!.setCoverFromFile(file)).rejects.toThrow('Failed to process image');

    expect(savePendingImageUpload).not.toHaveBeenCalled();
    expect(ref.ctx!.cover).toBeNull();
  });

  it('reports an undecodable HEIC with a clear message and sets nothing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no decoder'); }));
    const file = new File([new Uint8Array([1])], 'a.heic', { type: 'image/heic' });

    await expect(ref.ctx!.setCoverFromFile(file)).rejects.toThrow(/HEIC/);

    expect(savePendingImageUpload).not.toHaveBeenCalled();
    expect(ref.ctx!.cover).toBeNull();
  });
});

describe('forceReencode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('plans a small PNG/WebP re-encode only when forced', () => {
    const small = { type: 'image/png', size: 1024, width: 800, height: 600 };
    expect(planImageIngest(small).action).toBe('keep');
    expect(planImageIngest({ ...small, forceReencode: true }).action).toBe('reencode');
    expect(planImageIngest({ ...small, type: 'image/webp', forceReencode: true }).action).toBe('reencode');
  });

  it('still passes GIFs through when forced', async () => {
    const file = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' });
    expect(await prepareImageForUpload(file, { forceReencode: true })).toBe(file);
  });
});
