import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

const computed = (loc: import('@playwright/test').Locator) =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight) };
  });

test('H1-H6 are distinct from body text and step down in the editor and share-page prose', async ({ app }) => {
  await createNote(app, { title: 'Headings', body: '' });
  const editor = activeEditor(app);
  await editor.click();
  for (let n = 1; n <= 6; n++) {
    await editor.pressSequentially(`${'#'.repeat(n)} Level ${n}`);
    await editor.press('Enter');
  }
  await editor.pressSequentially('Body text');

  const check = async (root: import('@playwright/test').Locator) => {
    const para = await computed(root.locator('p', { hasText: 'Body text' }));
    const hs = [];
    for (let n = 1; n <= 6; n++) hs.push(await computed(root.locator(`h${n}`).first()));
    hs.forEach((h) => expect(h.size !== para.size || h.weight !== para.weight).toBe(true));
    for (let i = 1; i < 6; i++) {
      expect(hs[i].size).toBeLessThanOrEqual(hs[i - 1].size);
      expect(hs[i].weight).toBeLessThanOrEqual(hs[i - 1].weight);
    }
  };

  for (const scheme of ['light', 'dark'] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await check(editor);
    await app.screenshot({ path: test.info().outputPath(`headings-editor-${scheme}-desktop.png`) });
  }

  // Share page renders the same `.prose` class; mount a copy of the editor HTML in a .prose container.
  await app.evaluate(() => {
    const src = document.querySelector('.ProseMirror')!;
    const box = document.createElement('div');
    box.id = 'share-copy';
    box.className = 'prose';
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--background);padding:24px;overflow:auto';
    box.innerHTML = src.innerHTML;
    document.body.appendChild(box);
  });
  const share = app.locator('#share-copy');
  for (const scheme of ['light', 'dark'] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    await check(share);
    await app.screenshot({ path: test.info().outputPath(`headings-share-${scheme}-desktop.png`) });
  }
  await app.setViewportSize({ width: 390, height: 800 });
  await check(share);
  await app.screenshot({ path: test.info().outputPath('headings-share-light-mobile.png') });
});
