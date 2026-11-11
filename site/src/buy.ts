// The buy page (#305): look up an identity's license, open Dodo's checkout, and on the way back
// wait for the license to show up. The billing Worker (#300) holds the licenses; no account here.
import { checkoutError, paymentReturn, parseOdinId, type License } from './license';

declare const __BILLING_URL__: string;
// The only return URL the Worker accepts: this page in production, with no query.
const RETURN_URL = 'https://journal.cloudx.run/landing/buy';
// The identity and its updatesUntil before checkout, so the return can tell when the purchase lands.
const PENDING_KEY = 'journal-buy-pending';
// /license is cached for 60 s and the webhook can lag the redirect: about 100 s in all.
const POLL_MS = 5000;
const POLL_TRIES = 20;

const form = document.querySelector<HTMLFormElement>('#buy-form')!;
const input = form.querySelector<HTMLInputElement>('#odin-id')!;
const status = form.querySelector<HTMLElement>('#odin-status')!;
const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const done = document.querySelector<HTMLElement>('#buy-done')!;
const doneTitle = done.querySelector<HTMLElement>('h2')!;
const doneDetail = done.querySelector<HTMLElement>('p')!;
const again = done.querySelector<HTMLButtonElement>('button')!;
const BUY_LABEL = submit.textContent!;
const RENEW_LABEL = submit.dataset.renew!;

const date = (iso: string) => new Date(iso).toLocaleDateString('en', { dateStyle: 'long' });

async function fetchLicense(odinId: string): Promise<License> {
  const res = await fetch(`${__BILLING_URL__}/license/${encodeURIComponent(odinId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`license ${res.status}`);
  return res.json();
}

function say(text: string, error = false): void {
  status.textContent = text;
  status.toggleAttribute('data-error', error);
  input.setAttribute('aria-invalid', String(error && !parseOdinId(input.value)));
}

// ---- The identity's license, looked up as it is typed ----

let known: { odinId: string; license: License } | null = null;
let lookup = 0;

async function check(): Promise<void> {
  const ticket = ++lookup;
  const odinId = parseOdinId(input.value);
  known = null;
  submit.textContent = BUY_LABEL;
  if (!odinId) return say('');
  say('Checking the license…');
  try {
    const license = await fetchLicense(odinId);
    if (ticket !== lookup) return;
    known = { odinId, license };
    const until = license.updatesUntil;
    if (!license.licensed || !until) {
      say(`${odinId} has no license yet.`);
    } else {
      submit.textContent = RENEW_LABEL;
      say(Date.parse(until) > Date.now()
        ? `${odinId} is licensed, with updates until ${date(until)}. Renewing adds a year after that.`
        : `${odinId} is licensed. Its year of updates ended on ${date(until)}. Renewing adds a year from the day you pay.`);
    }
  } catch {
    if (ticket === lookup) say('Could not check the license just now. Checkout still picks the right price.');
  }
}

let typing: number | undefined;
input.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(check, 400);
});
input.addEventListener('change', () => {
  if (input.value.trim() && !parseOdinId(input.value)) say('That is not an identity. An identity looks like a domain name, such as you.example.com.', true);
});

// ---- Checkout: the Worker makes a Dodo session for the identity and the page goes there ----

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const odinId = parseOdinId(input.value);
  if (!odinId) {
    say(input.value.trim() ? 'That is not an identity. An identity looks like a domain name, such as you.example.com.' : 'Enter your Homebase identity first.', true);
    input.focus();
    return;
  }
  submit.disabled = true;
  const label = submit.textContent;
  submit.textContent = 'Opening checkout…';
  let res: Response | null = null;
  try {
    res = await fetch(`${__BILLING_URL__}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ odinId, returnUrl: RETURN_URL }),
    });
    const { url } = res.ok ? await res.json() : {};
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('no checkout url');
    const until = known?.odinId === odinId ? known.license.updatesUntil : null;
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ odinId, until }));
    } catch {
      // Private mode: the return asks for the identity again.
    }
    location.assign(url);
  } catch {
    say(checkoutError(res && !res.ok ? res.status : res ? 502 : null), true);
    submit.disabled = false;
    submit.textContent = label;
  }
});

// ---- The return from checkout: wait for the license, then send the buyer back to the app ----

function pending(): { odinId: string; until: string | null } | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
    return value && parseOdinId(String(value.odinId)) ? value : null;
  } catch {
    return null;
  }
}

function show(title: string, detail: string, retry = false): void {
  done.hidden = false;
  doneTitle.textContent = title;
  doneDetail.textContent = detail;
  again.hidden = !retry;
}

async function waitForLicense(odinId: string, before: string | null): Promise<void> {
  form.hidden = true;
  show('Payment received', `Turning on the license for ${odinId}…`);
  for (let i = 0; i < POLL_TRIES; i++) {
    try {
      const license = await fetchLicense(odinId);
      if (license.licensed && license.updatesUntil && license.updatesUntil !== before) {
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {
          // nothing stored
        }
        show('Done. Go back to the app.', `${odinId} is licensed, with updates until ${date(license.updatesUntil)}.`);
        doneTitle.focus();
        return;
      }
    } catch {
      // A slow or failed lookup is tried again with the rest.
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  show('Payment received', `The license for ${odinId} has not shown up yet. It can take a few minutes.`, true);
}

const query = new URLSearchParams(location.search);
const back = paymentReturn(location.search);
const stored = back ? pending() : null;
input.value = stored?.odinId ?? query.get('odinId') ?? '';
// Dodo's return carries the payment id and the buyer's email: keep neither in the address bar.
if (back) history.replaceState(null, '', input.value ? `?odinId=${encodeURIComponent(input.value)}` : location.pathname);

if (back === 'succeeded' && stored) {
  again.addEventListener('click', () => waitForLicense(stored.odinId, stored.until));
  waitForLicense(stored.odinId, stored.until);
} else {
  if (back === 'succeeded') show('Payment received', 'Enter your identity below to see its license.');
  if (back === 'processing') show('Payment processing', 'Your bank is still confirming the payment. The license turns on when it clears.');
  if (back === 'failed') show('Payment not completed', 'The payment did not go through. You can try again below.');
  if (input.value) check();
}
