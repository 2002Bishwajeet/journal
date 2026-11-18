import { test, expect } from '../fixtures';
import { activeEditor, createNote, waitForNoteSaved } from '../support/actions';

// The selection bubble appears at its final spot on its first painted frame: it only fades and
// zooms in, it does not travel in from the window's top-left corner (#1410).

interface Frame {
  x: number;
  y: number;
  left: string;
  top: string;
}

test('selection bubble does not travel from the top-left as it appears', async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  const body = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  await createNote(app, { title: `Bubble travel ${Date.now()}`, body });
  await waitForNoteSaved(app);
  await expect(activeEditor(app)).toContainText(body);
  await activeEditor(app).click();

  // Sample the bubble's centre on every frame from now on.
  await app.evaluate(() => {
    const w = window as unknown as { __bubbleFrames: Frame[]; __bubbleStop: boolean };
    w.__bubbleFrames = [];
    w.__bubbleStop = false;
    const tick = () => {
      const el = document.querySelector('[title="Bold"]')?.parentElement as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        w.__bubbleFrames.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, left: el.style.left, top: el.style.top });
      }
      if (!w.__bubbleStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await activeEditor(app).locator('p').first().evaluate((p) => {
    const text = p.firstChild as Text;
    const start = text.data.indexOf('word10');
    getSelection()!.setBaseAndExtent(text, start, text, start + 'word10 word11 word12'.length);
  });
  await expect(app.getByTitle('Bold', { exact: true })).toBeVisible();
  await app.waitForTimeout(400); // past the 150ms entry animation

  const frames = await app.evaluate(() => {
    const w = window as unknown as { __bubbleFrames: Frame[]; __bubbleStop: boolean };
    w.__bubbleStop = true;
    return w.__bubbleFrames;
  });
  expect(frames.length).toBeGreaterThan(3);
  const final = frames[frames.length - 1];
  for (const f of frames) {
    expect(Math.abs(f.x - final.x), `frame ${JSON.stringify(f)} vs final ${JSON.stringify(final)}`).toBeLessThan(6);
    expect(Math.abs(f.y - final.y), `frame ${JSON.stringify(f)} vs final ${JSON.stringify(final)}`).toBeLessThan(6);
  }
});
