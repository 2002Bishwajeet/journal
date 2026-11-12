import { toast } from 'sonner';
import { hasNativePlugin, invokeNative, nativePlatform } from '@/lib/native';
import type { BridgeAction } from '@/lib/native/bridge';
import { importActions } from '@/lib/native/bridgeImport';
import { sharedNote } from '@/lib/sharedNote';

// macOS Services (#1118): "New Journal Note from Selection" and "Add to Today's Journal Note".
// The premium plugin (native/rust/services.rs) holds each call until the web takes it; the
// web imports it once by its id and acks it.
const PLUGIN = 'journal-services';

/** Emitted by the plugin for every call; `services_take` hands the held calls over. */
const RECEIVED_EVENT = 'services://received';

/** One held call, as `services_take` returns it. */
export interface ServiceCall {
    id: string;
    kind: 'new_note' | 'append_today';
    text: string;
    /** Milliseconds since the epoch. */
    createdAt: number;
}

const URL_ONLY = /^https?:\/\/\S+$/i;

/**
 * The import action for a call. A new note's first line is its title, as in quick capture;
 * a selection that is only a URL becomes the share target's link note instead.
 */
export function serviceAction(call: ServiceCall): BridgeAction {
    let text = call.text.trim();
    if (call.kind === 'new_note' && URL_ONLY.test(text)) {
        const note = sharedNote({ url: text });
        text = `${note.title}\n${note.content}`;
    }
    return { id: call.id, type: call.kind, text, createdAt: new Date(call.createdAt).toISOString(), source: 'services' };
}

/** True in the macOS app with the premium plugin; false on the web and in the public build. */
export function hasMacServices(): boolean {
    return nativePlatform() === 'macos' && hasNativePlugin(PLUGIN);
}

/** Imports the held calls once each and acks them. A call that fails stays held. */
export async function importServiceCalls(): Promise<void> {
    const calls = (await invokeNative<ServiceCall[]>(PLUGIN, 'services_take')) ?? [];
    const { ack } = await importActions(calls.map(serviceAction));
    if (ack.length === 0) return;
    await invokeNative(PLUGIN, 'services_ack', { ids: ack });
    const appended = calls.every((call) => call.kind === 'append_today' || !ack.includes(call.id));
    toast.success(appended ? "Added to today's note" : 'Saved to Journal');
}

/**
 * Imports the calls held now and each one that comes in, one import at a time. Returns a
 * function that stops listening. Does nothing outside the macOS app.
 */
export function importServiceCallsWhileMounted(): () => void {
    if (!hasMacServices()) return () => {};
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let running = Promise.resolve();

    const fail = (err: unknown) => console.error('[macServices] Import failed:', err);
    const drain = () => {
        running = running.then(() => (stopped ? undefined : importServiceCalls())).catch(fail);
        return running;
    };

    import('@tauri-apps/api/event')
        .then(async ({ listen }) => {
            const stop = await listen(RECEIVED_EVENT, () => void drain());
            if (stopped) return stop();
            unlisten = stop;
            await drain();
        })
        .catch(fail);

    return () => {
        stopped = true;
        unlisten?.();
    };
}
