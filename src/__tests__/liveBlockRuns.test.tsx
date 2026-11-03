// @vitest-environment happy-dom
/**
 * Click-to-run for live blocks someone else may have written (#947): a block in the
 * owner's own note runs at once; one in a note shared with them, on the share page, or
 * in a note an agent or a collaborator edited last shows a Run button until it is run,
 * and this device remembers the code that was run.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveBlockFrame } from '@/components/liveBlocks/LiveBlockFrame';
import { ownerWroteNote } from '@/lib/liveBlockRuns';
import type { LiveBlockKind } from '@/lib/liveBlocks';
import { LIVE_BLOCK_RUNS_KEY } from '@/lib/storage';

const ME = 'me.homebase.test';

describe('ownerWroteNote', () => {
  it('should trust a note the identity owns and last edited, or that nobody is named as editing', () => {
    expect(ownerWroteNote({}, ME)).toBe(true);
    expect(ownerWroteNote({ authorOdinId: ME, lastEditedBy: ME }, ME)).toBe(true);
    expect(ownerWroteNote({ lastEditedBy: ME }, ME)).toBe(true);
  });

  it('should not trust a note shared with the identity, even one it edited last', () => {
    expect(ownerWroteNote({ authorOdinId: 'friend.homebase.test' }, ME)).toBe(false);
    expect(ownerWroteNote({ authorOdinId: 'friend.homebase.test', lastEditedBy: ME }, ME)).toBe(false);
  });

  it('should not trust an own note that an agent or a collaborator edited last', () => {
    expect(ownerWroteNote({ lastEditedBy: 'agent:claude-code' }, ME)).toBe(false);
    expect(ownerWroteNote({ authorOdinId: ME, lastEditedBy: 'friend.homebase.test' }, ME)).toBe(false);
  });

  it('should not trust a note with an editor when the identity is unknown', () => {
    expect(ownerWroteNote({ lastEditedBy: ME }, undefined)).toBe(false);
  });
});

describe('LiveBlockFrame run gate', () => {
  let root: Root;
  let note: HTMLDivElement;

  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    note = document.body.appendChild(document.createElement('div'));
    root = createRoot(note);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    note.remove();
    localStorage.clear();
  });

  const render = (trusted: boolean, source = '<h1>Hi</h1>', kind: LiveBlockKind = 'html') =>
    act(async () =>
      root.render(
        <LiveBlockFrame kind={kind} source={source} preview trusted={trusted} toggles={null}>
          {null}
        </LiveBlockFrame>,
      ),
    );
  const runButton = () => note.querySelector<HTMLButtonElement>('button[aria-label^="Run "]');
  const frame = () => note.querySelector('iframe');
  /** Waits for the lookup of an earlier run to settle: a Run button or the block's frame. */
  const settled = async () => {
    for (let i = 0; i < 50 && !runButton() && !frame(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  };

  it("should run a block in the owner's own note without asking", async () => {
    await render(true);
    expect(frame()?.getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
    expect(runButton()).toBeNull();
  });

  it('should show the kind and a Run button in place of the frame until the block is run', async () => {
    await render(false);
    await settled();
    expect(frame()).toBeNull();
    expect(runButton()?.getAttribute('aria-label')).toBe('Run HTML block');
    expect(note.textContent).toContain('HTML block');

    await act(async () => runButton()!.click());
    expect(frame()?.getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
    expect(runButton()).toBeNull();
  });

  it('should ask for a react block too, and never for a mermaid or svg block (none of their code runs)', async () => {
    await render(false, 'export default () => <p>Hi</p>', 'react');
    await settled();
    expect(runButton()?.getAttribute('aria-label')).toBe('Run React block');

    await render(false, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'svg');
    expect(runButton()).toBeNull();
    expect(note.querySelector('img')).not.toBeNull();
  });

  it('should run code this device already ran, and ask again once the code changes', async () => {
    await render(false);
    await settled();
    await act(async () => runButton()!.click());
    for (let i = 0; i < 50 && !localStorage.getItem(LIVE_BLOCK_RUNS_KEY); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await act(async () => root.unmount());

    // As after a reload: a new block with the same code.
    root = createRoot(note);
    await render(false);
    await settled();
    expect(runButton()).toBeNull();
    expect(frame()).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(LIVE_BLOCK_RUNS_KEY)!)).toHaveLength(1);

    // A collaborator changed the code: it asks again before the new code runs.
    await render(false, '<form>Session expired, sign in</form>');
    await settled();
    expect(frame()).toBeNull();
    expect(runButton()).not.toBeNull();
  });
});
