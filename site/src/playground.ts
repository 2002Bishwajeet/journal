import mermaid from 'mermaid';

// Mermaid themed like the app's live blocks (src/components/liveBlocks/LiveBlockPreview.tsx), with the
// flat `classic` look. The preview pane is the Beige band, so nodes take the page's paper (or night) tone.
function themeVariables(dark: boolean) {
  return dark
    ? { darkMode: true, background: '#242321', primaryColor: '#1C1B1A', primaryTextColor: '#E6E4DD', primaryBorderColor: '#8A8780', lineColor: '#8A8780', edgeLabelBackground: '#242321' }
    : { darkMode: false, background: '#F2F0E9', primaryColor: '#FDFCF8', primaryTextColor: '#2C2B29', primaryBorderColor: '#8A8780', lineColor: '#8A8780', edgeLabelBackground: '#F2F0E9' };
}

export function startPlayground(root: HTMLElement): void {
  const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const output = root.querySelector<HTMLElement>('#pg-output')!;
  const status = root.querySelector<HTMLElement>('.pg-status')!;
  let run = 0;
  let timer: number | undefined;
  // A phone column fits a diagram that runs top to bottom.
  if (matchMedia('(max-width: 599px)').matches) input.value = input.value.replace(/^graph LR/, 'graph TD');

  async function render(): Promise<void> {
    const mine = ++run;
    const dark = document.documentElement.dataset.theme === 'dark';
    await document.fonts.ready;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      look: 'classic',
      theme: 'base',
      themeVariables: { fontFamily: 'Inter Variable, Inter, system-ui, sans-serif', fontSize: '15px', ...themeVariables(dark) },
    });
    try {
      const { svg } = await mermaid.render(`pg-${mine}`, input.value);
      if (mine !== run) return;
      output.innerHTML = svg;
      status.textContent = 'Rendered';
      status.removeAttribute('data-error');
    } catch {
      // Mermaid leaves its error diagram in <body>; the last good diagram stays shown.
      document.getElementById(`dpg-${mine}`)?.remove();
      if (mine !== run) return;
      status.textContent = 'Keep typing: this is not a diagram yet';
      status.setAttribute('data-error', '');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 250);
  });
  window.addEventListener('themechange', render);
  render();
}
