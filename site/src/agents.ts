// ---- Agents page: the install card. Each command row has its own Copy button, and the
// "Your Homebase address" field writes the address into every command as you type. ----

export const IDENTITY_PLACEHOLDER = 'type.your.identity.here';

/** The address as a command takes it: a pasted `https://alex.dotyou.cloud/` becomes `alex.dotyou.cloud`. */
export function identityFrom(value: string): string {
  return value.trim().replace(/^[a-z]+:\/\//i, '').split('/')[0].toLowerCase();
}

export function startInstallCard(root: ParentNode): void {
  // Without script the field can't do anything, so the page ships it hidden and the placeholder stays.
  const field = root.querySelector<HTMLElement>('.identity-field');
  const input = field?.querySelector('input');
  if (field && input) {
    field.hidden = false;
    input.addEventListener('input', () => {
      const identity = identityFrom(input.value);
      root.querySelectorAll('.identity').forEach((el) => (el.textContent = identity || IDENTITY_PLACEHOLDER));
      root.querySelectorAll<HTMLElement>('.identity-hint').forEach((el) => (el.hidden = !!identity));
    });
  }

  root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
    const label = button.querySelector('.copy-label')!;
    let timer: number | undefined;
    button.addEventListener('click', async () => {
      const text = root.querySelector(`#${button.dataset.copy}`)!.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        label.textContent = 'Copied';
        button.toggleAttribute('data-copied', true);
      } catch {
        label.textContent = 'Select and copy';
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.textContent = 'Copy';
        button.toggleAttribute('data-copied', false);
      }, 1800);
    });
  });
}
