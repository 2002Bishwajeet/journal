// A routing hint for the edge (functions/index.ts, #913): with this cookie, / serves the app;
// without it, the landing page. It holds no secret and is never auth: the app checks its own token.
// site/index.html sets the same cookie for a browser that signed in before the cookie existed.
export const SESSION_HINT_COOKIE = 'journal_session';

const ATTRIBUTES = 'Path=/; Secure; SameSite=Lax';

/** Set (or refresh, for 400 days) the hint: on sign-in and on every signed-in boot. */
export function setSessionHint(): void {
    document.cookie = `${SESSION_HINT_COOKIE}=1; ${ATTRIBUTES}; Max-Age=34560000`;
}

/** Remove the hint on logout, so / shows the landing page again. */
export function clearSessionHint(): void {
    document.cookie = `${SESSION_HINT_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
}
