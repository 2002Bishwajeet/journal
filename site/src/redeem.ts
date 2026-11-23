// The invite redeem page (#1464): an invite link (?code=…) gets a free lifetime license key from the
// billing Worker (journal-billing POST /invite/redeem). The key is shown here once, never stored.
import { keyFile, looksLikeEmail, maskCode, redeemBody, redeemError } from './invite';

declare const __BILLING_URL__: string;

const form = document.querySelector<HTMLFormElement>('#redeem-form')!;
const codeShown = form.querySelector<HTMLElement>('#redeem-code')!;
const codeField = form.querySelector<HTMLElement>('#redeem-code-field')!;
const codeInput = form.querySelector<HTMLInputElement>('#redeem-code-input')!;
const emailInput = form.querySelector<HTMLInputElement>('#redeem-email')!;
const status = form.querySelector<HTMLElement>('#redeem-status')!;
const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const done = document.querySelector<HTMLElement>('#redeem-done')!;
const keyText = done.querySelector<HTMLElement>('#redeem-key')!;
const copy = done.querySelector<HTMLButtonElement>('#redeem-copy')!;
const save = done.querySelector<HTMLButtonElement>('#redeem-save')!;
const saved = done.querySelector<HTMLElement>('#redeem-saved')!;

// Read the code (the fragment first, #code=…, which never reaches a server; then ?code=…), then drop both at
// once. This cleans the address bar and this tab's history entry; it can't reach history a browser already synced.
const fromLink = (params: string) => new URLSearchParams(params).get('code')?.trim() || null;
const linkCode = fromLink(location.hash.slice(1)) ?? fromLink(location.search);
if (location.search || location.hash) history.replaceState(null, '', location.pathname);
// Sent with every try: the Worker answers a retry of the same code and request with the same key. A new one
// when the email changed since the last try, so a corrected email isn't answered with the typo'd one's key.
let requestId = crypto.randomUUID();
let sentEmail: string | null = null;
if (linkCode) {
  codeShown.querySelector('strong')!.textContent = maskCode(linkCode);
  codeShown.hidden = false;
  codeField.hidden = true;
}

function fail(text: string, field?: HTMLInputElement): void {
  status.textContent = text;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

for (const field of [codeInput, emailInput]) {
  field.addEventListener('input', () => {
    status.textContent = '';
    field.removeAttribute('aria-invalid');
  });
}

function showKey(key: string): void {
  form.hidden = true;
  keyText.textContent = key;
  done.hidden = false;
  done.querySelector<HTMLElement>('h2')!.focus();

  // The key is shown once: ask before the page goes away, until it has been copied or saved.
  const keepKey = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = ''; // older Safari asks only when this is set
  };
  window.addEventListener('beforeunload', keepKey);
  const kept = () => window.removeEventListener('beforeunload', keepKey);

  let timer: number | undefined;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(key);
      copy.textContent = 'Copied';
      kept();
      saved.textContent = 'Key copied. Keep a copy somewhere safe too, like your notes or a password manager.';
    } catch {
      getSelection()?.selectAllChildren(keyText);
      copy.textContent = 'Select and copy';
      saved.textContent = 'The key is selected. Copy it with Ctrl+C, or Command+C on a Mac.';
    }
    clearTimeout(timer);
    timer = window.setTimeout(() => (copy.textContent = 'Copy key'), 2000);
  });
  save.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([keyFile(key)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'journal-license-key.txt';
    link.click();
    kept();
    saved.textContent = 'Saved as journal-license-key.txt, in your downloads.';
    // Long enough for a slow device to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = linkCode ?? codeInput.value.trim();
  const email = emailInput.value.trim();
  if (!code) return fail('Enter the code from your invite.', codeInput);
  if (email && !looksLikeEmail(email)) return fail('That email address looks incomplete. Check it, or leave it empty.', emailInput);

  if (sentEmail !== null && email !== sentEmail) requestId = crypto.randomUUID();
  sentEmail = email;
  status.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Getting your key…';
  let res: Response | null;
  for (let retries = 0; ; retries++) {
    try {
      res = await fetch(`${__BILLING_URL__}/invite/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(redeemBody(code, email, requestId)),
      });
    } catch {
      res = null; // Not reached: the message below asks to try again.
    }
    // 409: this request id's first try is still waiting on the key. Ask again shortly, up to 3 times.
    if (res?.status !== 409 || retries === 3) break;
    await new Promise((wait) => setTimeout(wait, 2000));
  }
  const key = res?.ok ? await res.json().then((b) => b?.licenseKey, () => null) : null;
  submit.disabled = false;
  submit.textContent = 'Get my key';
  if (typeof key === 'string' && key) return showKey(key);
  fail(redeemError(res ? (res.ok ? 502 : res.status) : null));
});
