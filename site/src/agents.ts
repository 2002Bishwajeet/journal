// ---- Agents page: the install card. Each command row has its own Copy button, and the
// "Your Homebase address" field writes the address into every command as you type. ----

export const IDENTITY_PLACEHOLDER = 'type.your.identity.here';

/** The address as a command takes it: a pasted `https://alex.dotyou.cloud/` becomes `alex.dotyou.cloud`,
 *  and a stray space typed on a phone is dropped rather than splitting the command. */
export function identityFrom(value: string): string {
  return value.replace(/\s/g, '').replace(/^[a-z]+:\/\//i, '').split('/')[0].toLowerCase();
}

export function startInstallCard(root: ParentNode): void {
  // Without script the field can't do anything, so the page ships it hidden and the placeholder stays.
  const field = root.querySelector<HTMLElement>('.identity-field');
  const input = field?.querySelector('input');
  if (field && input) {
    field.hidden = false;
    input.addEventListener('input', () => {
      const identity = identityFrom(input.value);
      root.querySelectorAll<HTMLElement>('.identity').forEach((el) => {
        el.textContent = identity || IDENTITY_PLACEHOLDER;
        el.toggleAttribute('data-filled', !!identity);
      });
      root.querySelectorAll<HTMLElement>('.identity-hint').forEach((el) => (el.hidden = !!identity));
    });
  }

  // The buttons carry an aria-label, so a changed label isn't heard; this live region says what happened.
  const status = root.querySelector('#copy-status');
  root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
    const label = button.querySelector('.copy-label')!;
    let timer: number | undefined;
    button.addEventListener('click', async () => {
      const code = root.querySelector(`#${button.dataset.copy}`)!;
      const what = (button.getAttribute('aria-label') ?? '').replace(/^Copy /, '');
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        label.textContent = 'Copied';
        button.toggleAttribute('data-copied', true);
        if (status) status.textContent = `Copied ${what}`;
      } catch {
        // No clipboard access: select the command, so one Ctrl+C, ⌘C or long press copies it.
        const range = document.createRange();
        range.selectNodeContents(code);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        label.textContent = 'Selected, now copy';
        if (status) status.textContent = `Couldn't copy ${what} by itself. It is selected: press Ctrl+C or ⌘C, or press and hold on a phone.`;
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.textContent = 'Copy';
        button.toggleAttribute('data-copied', false);
        if (status) status.textContent = '';
      }, 1800);
    });
  });
}
