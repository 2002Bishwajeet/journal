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

// Read the code, then drop the whole query at once so it stays out of the address bar, the history and any referrer.
const linkCode = new URLSearchParams(location.search).get('code')?.trim() || null;
if (location.search) history.replaceState(null, '', location.pathname);
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

  let timer: number | undefined;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(key);
      copy.textContent = 'Copied';
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
    saved.textContent = 'Saved as journal-license-key.txt, in your downloads.';
    setTimeout(() => URL.revokeObjectURL(url));
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = linkCode ?? codeInput.value.trim();
  const email = emailInput.value.trim();
  if (!code) return fail('Enter the code from your invite.', codeInput);
  if (email && !looksLikeEmail(email)) return fail('That email address looks incomplete. Check it, or leave it empty.', emailInput);

  status.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Getting your key…';
  let res: Response | null = null;
  try {
    res = await fetch(`${__BILLING_URL__}/invite/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(redeemBody(code, email)),
    });
  } catch {
    // Not reached: the message below asks to try again.
  }
  const key = res?.ok ? await res.json().then((b) => b?.licenseKey, () => null) : null;
  submit.disabled = false;
  submit.textContent = 'Get my key';
  if (typeof key === 'string' && key) return showKey(key);
  fail(redeemError(res ? (res.ok ? 502 : res.status) : null));
});
