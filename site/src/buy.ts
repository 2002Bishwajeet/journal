// The buy page (#305): open Dodo's checkout for a new license key or a renewal, and say what
// happened on the way back. The billing Worker (journal-billing) makes the checkout; the key is
// emailed by Dodo and activated inside the apps, never here.
import { checkoutBody, checkoutError, maskKey, parseLicenseKey, paymentReturn } from './license';

declare const __BILLING_URL__: string;
// Which checkout was opened, so the return can tell a renewal from a new key. Never the key itself.
const KIND_KEY = 'journal-buy-kind';

const done = document.querySelector<HTMLElement>('#buy-done')!;
const doneTitle = done.querySelector<HTMLElement>('h2')!;
const doneDetail = done.querySelector<HTMLElement>('p')!;

function show(title: string, detail: string): void {
  done.hidden = false;
  doneTitle.textContent = title;
  doneDetail.textContent = detail;
  doneTitle.focus();
}

// ---- The return from checkout ----
// Dodo appends payment_id, status, license_key and email. Read the status, then drop the whole query
// at once so the key and the email stay out of the address bar, the history and any later referrer.
const back = paymentReturn(location.search);
if (back) {
  history.replaceState(null, '', location.pathname);
  let kind: string | null = null;
  try {
    kind = sessionStorage.getItem(KIND_KEY);
    sessionStorage.removeItem(KIND_KEY);
  } catch {
    // Private mode: the generic message below covers both.
  }
  // Paid or on its way: no second buy button under the message. A failed payment keeps them, to try again.
  if (back !== 'failed') document.querySelectorAll<HTMLElement>('.buy-panel > :not(#buy-done)').forEach((el) => (el.hidden = true));
  if (back === 'succeeded' && kind === 'renew') {
    show('Updates renewed', 'Your key now has another year of updates. Journal+ picks it up at its next check, so there is nothing to enter.');
  } else if (back === 'succeeded') {
    show('Payment done', 'Check your email for your license key. It comes with the receipt from Dodo Payments. Enter the key in Journal+ to unlock the app.');
  } else if (back === 'processing') {
    show('Payment processing', 'Your bank is still confirming the payment. The email with your key follows when it clears.');
  } else {
    show('Payment not completed', 'The payment did not go through, so nothing was charged. You can try again.');
  }
}

// ---- Checkout, when the build has billing on (VITE_BILLING_LIVE, site/vite.config.ts) ----

const buy = document.querySelector<HTMLButtonElement>('#buy-new');
const renewForm = document.querySelector<HTMLFormElement>('#renew-form');

async function checkout(button: HTMLButtonElement, status: HTMLElement, licenseKey: string | null): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Opening checkout…';
  status.textContent = '';
  let res: Response | null = null;
  try {
    res = await fetch(`${__BILLING_URL__}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutBody(licenseKey)),
    });
    const { url } = res.ok ? await res.json() : {};
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('no checkout url');
    try {
      sessionStorage.setItem(KIND_KEY, licenseKey ? 'renew' : 'buy');
    } catch {
      // Private mode: the return shows the generic message.
    }
    location.assign(url);
  } catch {
    status.textContent = checkoutError(res && !res.ok ? res.status : res ? 502 : null, licenseKey !== null);
    button.disabled = false;
    button.textContent = label;
  }
}

if (buy) {
  const status = document.querySelector<HTMLElement>('#buy-status')!;
  buy.addEventListener('click', () => checkout(buy, status, null));
}

if (renewForm) {
  const input = renewForm.querySelector<HTMLInputElement>('#license-key')!;
  const status = renewForm.querySelector<HTMLElement>('#renew-status')!;
  const submit = renewForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  // The key lives here once entered; the field shows only its masked form until it is edited again.
  let key: string | null = null;

  const fail = (text: string) => {
    status.textContent = text;
    input.setAttribute('aria-invalid', 'true');
  };

  input.addEventListener('focus', () => {
    if (key && input.value === maskKey(key)) input.value = key;
  });
  input.addEventListener('input', () => {
    key = null;
    status.textContent = '';
    input.removeAttribute('aria-invalid');
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) return;
    key = parseLicenseKey(input.value);
    if (key) input.value = maskKey(key);
    else fail('That does not look like a license key. Copy it from the email it came in.');
  });

  renewForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = key ?? parseLicenseKey(input.value);
    if (!entered) {
      fail(input.value.trim() ? 'That does not look like a license key. Copy it from the email it came in.' : 'Enter your license key first.');
      input.focus();
      return;
    }
    key = entered;
    input.value = maskKey(entered);
    checkout(submit, status, entered);
  });
}
