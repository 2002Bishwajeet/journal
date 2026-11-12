import { useEffect } from 'react';
import { useCanEditAnswer } from '@/hooks/useCanEdit';
import { importServiceCallsWhileMounted } from '@/lib/native/macServices';

/**
 * macOS app, signed in: imports the text sent from the Services menu (#1118). While the
 * device is read-only (#1176) the calls stay held in the native queue.
 */
export function useMacServices(): void {
    const canEdit = useCanEditAnswer() === true;
    useEffect(() => (canEdit ? importServiceCallsWhileMounted() : undefined), [canEdit]);
}
