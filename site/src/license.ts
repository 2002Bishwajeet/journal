// The buy page's rules, kept apart from the DOM so they can be tested (src/__tests__/buyPage.test.ts).

/** The only return URL the billing Worker accepts: this page in production, with no query. */
export const RETURN_URL = 'https://journal.cloudx.run/landing/buy';

/** The billing Worker's own key rule (journal-billing src/license.ts): trimmed, 8–100 of A-Z a-z 0-9 _ -. Case-sensitive. */
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** The license key as the Worker will take it, or null. */
export function parseLicenseKey(value: string): string | null {
  const key = value.trim();
  return KEY.test(key) ? key : null;
}

/** What the key field shows once the key is entered: dots, then its last four characters to tell keys apart. */
export function maskKey(key: string): string {
  return `${'•'.repeat(8)}${key.slice(-4)}`;
}

/** The POST /checkout body: a new license without a key, a renewal of that key with one. */
export function checkoutBody(licenseKey: string | null): { returnUrl: string; licenseKey?: string } {
  return licenseKey ? { returnUrl: RETURN_URL, licenseKey } : { returnUrl: RETURN_URL };
}

/**
 * What Dodo's return to this page says: it appends `?payment_id=…&status=…` (and the key and the
 * buyer's email) to the return URL. null when the page was not opened by a return from checkout.
 */
export function paymentReturn(search: string): 'succeeded' | 'processing' | 'failed' | null {
  const query = new URLSearchParams(search);
  if (!query.has('payment_id') && !query.has('status')) return null;
  const status = query.get('status');
  if (status === 'succeeded') return 'succeeded';
  if (status === 'processing' || status?.startsWith('requires_')) return 'processing';
  return 'failed';
}

/** What to tell the buyer when POST /checkout fails: `status` is the HTTP status, or null when the Worker was not reached. */
export function checkoutError(status: number | null, renewal: boolean): string {
  if (status === null) return 'Could not reach the checkout. Check your connection and try again.';
  if (status === 429) return 'Too many tries in a short time. Wait a minute, then try again.';
  if (status === 400 && renewal) return 'We could not find a license for that key. Check it against the email it came in.';
  return 'The checkout is not available at the moment. Nothing was charged. Try again in a few minutes.';
}
