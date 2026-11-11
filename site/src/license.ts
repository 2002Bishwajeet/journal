// The buy page's rules, kept apart from the DOM so they can be tested (src/__tests__/buyPage.test.ts).

/** The billing Worker's own rule (journal-billing src/license.ts): a lowercase hostname whose last label starts with a letter. */
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The identity as the Worker will take it, or null. A pasted address (https://, a trailing slash) is accepted. */
export function parseOdinId(value: string): string | null {
  const id = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return HOSTNAME.test(id) ? id : null;
}

export interface License {
  licensed: boolean;
  purchasedAt: string | null;
  updatesUntil: string | null;
}

/**
 * What Dodo's return to this page says: it appends `?payment_id=…&status=…` to the return URL.
 * null when the page was not opened by a return from checkout.
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
export function checkoutError(status: number | null): string {
  if (status === null) return 'Could not reach the checkout. Check your connection and try again.';
  if (status === 429) return 'Too many tries in a short time. Wait a minute, then try again.';
  if (status === 400) return 'The checkout did not accept this identity. Check the spelling and try again.';
  return 'The checkout is not available at the moment. Nothing was charged. Try again in a few minutes.';
}
