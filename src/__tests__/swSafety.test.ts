// @vitest-environment happy-dom
/**
 * Regression for #247: React 19 reports errors it already recovered from
 * (production "Minified React error #520", a concurrent render that succeeded
 * on a synchronous retry) through window `error`. sw-safety treated every
 * minified React error as a stale-cache crash and reload-looped the page.
 * Only duplicate/mismatched-React symptoms should trigger recovery.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

let reloadSpy: ReturnType<typeof vi.fn<() => void>>;

function fireWindowError(error: Error) {
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
}

describe('sw-safety fatal error handler', () => {
    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        await import('@/lib/utils/sw-safety');
    });

    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        reloadSpy = vi.fn<() => void>();
        vi.spyOn(window.location, 'reload').mockImplementation(reloadSpy);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not reload for an error React already recovered from (#520)', () => {
        fireWindowError(new Error(
            'Minified React error #520; visit https://react.dev/errors/520 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.',
            { cause: new TypeError("Cannot read properties of null (reading 'commands')") },
        ));
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it.each([185, 418, 423])('does not reload for React error #%i (an app bug, not a stale cache)', (code) => {
        fireWindowError(new Error(`Minified React error #${code}; visit https://react.dev/errors/${code} for the full message`));
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('does not reload for an unrelated null-property TypeError', () => {
        fireWindowError(new TypeError("Cannot read properties of null (reading 'user')"));
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it.each(['useState', 'useEffect', 'useContext'])('still reloads for the stale-bundle hook crash (%s)', (hook) => {
        fireWindowError(new TypeError(`Cannot read properties of null (reading '${hook}')`));
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('still reloads for an invalid hook call (#321, duplicate React)', () => {
        fireWindowError(new Error('Minified React error #321; visit https://react.dev/errors/321 for the full message'));
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
});
