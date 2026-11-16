import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain ESM dev script, no type declarations
import { closesIssue, specPrefix, pickShots, galleryBody } from '../../scripts/harness/evidence.mjs';

describe('harness prompts (#1324)', () => {
    const files = ['.claude/workflows/implement-epic.js', '.claude/commands/implement.md', '.claude/skills/e2e-verify/SKILL.md'];

    it.each(files)('%s never tells an agent to run e2e or Playwright, only to list specs', (file) => {
        const text = readFileSync(file, 'utf8');
        expect(text.match(/npm run e2e\S*|playwright test(?! --list)/g)).toBeNull();
    });
});

describe('closesIssue', () => {
    it('reads the issue from a Closes line', () => {
        expect(closesIssue('Closes #1324\n\n## Summary\nx')).toBe(1324);
    });

    it('returns null without one', () => {
        expect(closesIssue('Refs #12')).toBeNull();
        expect(closesIssue(null)).toBeNull();
    });
});

describe('specPrefix', () => {
    it('matches the start of Playwright test folder names', () => {
        expect(specPrefix('e2e/boot/welcome-note.spec.ts')).toBe('boot-welcome-note-');
        expect(specPrefix('e2e/editor/pickers.mobile.spec.ts')).toBe('editor-pickers.mobile-');
    });

    it('keeps the 26 characters a long folder name keeps', () => {
        expect(specPrefix('e2e/editor/note-actions-sheet.mobile.spec.ts')).toBe('editor-note-actions-sheet.');
    });
});

describe('pickShots', () => {
    const changed = ['e2e/boot/welcome-note.spec.ts', 'src/App.tsx', 'e2e/support/actions.ts'];

    it('keeps the screenshots of passing tests in changed specs', () => {
        const paths = [
            'e2e-evidence-1-1/test-results/boot-welcome-note-a-fresh-identity-gets-hermetic/welcome-note-light-desktop.png',
            'e2e-evidence-2-1/test-results/boot-welcome-signed-out-root-hermetic/welcome-light.png',
        ];
        expect(pickShots(paths, changed)).toEqual([paths[0]]);
    });

    it('leaves out every screenshot of a failed attempt, but keeps the passing retry', () => {
        const failed = 'e2e-evidence-1-1/test-results/boot-welcome-note-a-fresh-hermetic';
        const retry = 'e2e-evidence-1-1/test-results/boot-welcome-note-a-fresh-hermetic-retry1';
        const paths = [`${failed}/welcome-note-light-desktop.png`, `${failed}/test-failed-1.png`, `${retry}/welcome-note-light-desktop.png`];
        expect(pickShots(paths, changed)).toEqual([`${retry}/welcome-note-light-desktop.png`]);
    });

    it('finds mobile runs in their own folder', () => {
        const path = 'e2e-evidence-3-1/test-results/mobile/editor-pickers.mobile-slash-mobile-chromium/slash-dark-390.png';
        expect(pickShots([path], ['e2e/editor/pickers.mobile.spec.ts'])).toEqual([path]);
    });

    it('returns each file name once', () => {
        const paths = ['a/test-results/boot-welcome-note-x-hermetic/shot.png', 'b/test-results/boot-welcome-note-x-hermetic/shot.png'];
        expect(pickShots(paths, changed)).toEqual([paths[1]]);
    });

    it('returns nothing when the PR changes no spec', () => {
        expect(pickShots(['a/test-results/boot-welcome-note-x-hermetic/shot.png'], ['src/App.tsx'])).toEqual([]);
    });
});

describe('galleryBody', () => {
    it('shows each screenshot inline from the agent-evidence branch', () => {
        const body = galleryBody({ repo: 'o/r', issue: 7, names: ['a-light-390.png'], runUrl: 'https://github.com/o/r/actions/runs/1' });
        expect(body.startsWith('<!-- agent-evidence -->')).toBe(true);
        expect(body).toContain('<img src="https://raw.githubusercontent.com/o/r/agent-evidence/7/a-light-390.png" width="260">');
        expect(body).toContain('for #7 ([run](https://github.com/o/r/actions/runs/1))');
    });

    it('says so when there is nothing to show', () => {
        expect(galleryBody({ repo: 'o/r', issue: 7, names: [] })).toContain('No screenshots');
    });
});
