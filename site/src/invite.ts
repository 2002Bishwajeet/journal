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
export function redeemBody(code: string, email: string): { code: string; email?: string } {
  return email ? { code, email } : { code };
}

/** What to say when the redeem fails: `status` is the HTTP status, or null when the Worker was not reached. Never the code. */
export function redeemError(status: number | null): string {
  if (status === null) return 'Could not reach Journal. Check your connection and try again.';
  if (status === 404) return "This invite link isn't valid any more. It may have been used already or expired. Ask the person who sent it for a new one.";
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  return 'Your key could not be made just now. Try again in a few minutes.';
}

/** The text file Save writes. */
export function keyFile(key: string): string {
  return `Journal license key\n\n${key}\n\nA lifetime license for the Journal apps on up to 5 devices.\nOpen Journal and enter this key. On a computer it goes on the license screen; on iPhone or iPad, tap "Have a license key?" on the paywall.\nDownload the apps: https://journal.cloudx.run/landing/download\n`;
}
