/**
 * Regression: the last keystrokes before a note switch/unmount were lost from
 * the server. Content reaches Homebase only via the editor's debounced save,
 * and unmount cancelled the pending timer — so the final edits stayed in PGlite
 * but never got pushed. flushPendingSaveOnTeardown fires that pending save on
 * teardown, but only AFTER destroy()'s compaction so the upload can't read the
 * empty mid-compaction window and clobber the note.
 */
import { describe, it, expect, vi } from 'vitest';
import { flushPendingSaveOnTeardown } from '@/lib/yjs/flushPendingSave';

function fakeProvider() {
    let resolveDestroy!: () => void;
    const destroyed = new Promise<void>((r) => {
        resolveDestroy = r;
    });
    return {
        getFullState: vi.fn(() => new Uint8Array([1, 2, 3])),
        destroy: vi.fn(() => destroyed),
        finishDestroy: () => resolveDestroy(),
    };
}

describe('flushPendingSaveOnTeardown', () => {
    it('pushes the captured state, but only after destroy() resolves', async () => {
        const p = fakeProvider();
        const onSave = vi.fn();

        flushPendingSaveOnTeardown(p, true, onSave);

        // State captured synchronously (doc still alive); push deferred.
        expect(p.getFullState).toHaveBeenCalledTimes(1);
        expect(p.destroy).toHaveBeenCalledTimes(1);
        expect(onSave).not.toHaveBeenCalled();

        p.finishDestroy();
        await Promise.resolve();
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    });

    it('tears down without saving when nothing is pending', async () => {
        const p = fakeProvider();
        const onSave = vi.fn();

        flushPendingSaveOnTeardown(p, false, onSave);

        expect(p.destroy).toHaveBeenCalledTimes(1);
        expect(p.getFullState).not.toHaveBeenCalled();

        p.finishDestroy();
        await Promise.resolve();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('still tears down when there is no onSave handler', () => {
        const p = fakeProvider();
        expect(() => flushPendingSaveOnTeardown(p, true, undefined)).not.toThrow();
        expect(p.destroy).toHaveBeenCalledTimes(1);
        expect(p.getFullState).not.toHaveBeenCalled();
    });
});
