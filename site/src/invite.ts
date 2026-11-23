// The invite redeem page's rules, kept apart from the DOM (src/__tests__/redeemPage.test.ts).

/** The code as shown on the page: its first four characters, the rest as dots. */
export function maskCode(code: string): string {
  return code.slice(0, 4) + code.slice(4).replace(/[^-]/g, '•');
}

/** A loose check, so a typo is caught here rather than by the Worker. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** The POST /invite/redeem body: the email only when one was given. */
export function redeemBody(code: string, email: string, requestId: string): { code: string; requestId: string; email?: string } {
  return email ? { code, requestId, email } : { code, requestId };
}

/** What to say when the redeem fails: `status` is the HTTP status, or null when the Worker was not reached. Never the code.
 *  A 409 still there after the retries (the first try never finished) reads as a lost connection. */
export function redeemError(status: number | null): string {
  if (status === null || status === 409) return 'Could not reach Journal. Check your connection and try again.';
  if (status === 404) return "This invite link isn't valid any more. It may have been used already or expired. Ask the person who sent it for a new one.";
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  return 'Your key could not be made just now. Try again in a few minutes.';
}

/** The text file Save writes. */
export function keyFile(key: string): string {
  return `Journal license key\n\n${key}\n\nA lifetime license for the Journal apps on up to 5 devices.\nOpen Journal, sign in and paste this key. On a computer, open Settings, then Purchase. On iPhone or iPad, tap "Have a license key?" at the bottom of the screen.\nDownload the apps: https://journal.cloudx.run/landing/download\n`;
}
