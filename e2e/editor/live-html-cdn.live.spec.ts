import type { Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';

// #409: an html block loads one real file from each of the three allowlisted CDN
// hosts, under the COEP headers the app is really served with. The hermetic proof,
// with a faked CDN, is e2e/editor/live-html-sandbox.spec.ts.

const REACT = 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js';
const REACT_DOM = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js';
const DAYJS = 'https://cdnjs.cloudflare.com/ajax/libs/dayjs/1.11.13/dayjs.min.js';

const SOURCE = [
    '<div id="root">waiting for the CDN scripts</div>',
    `<script src="${REACT}"></script>`,
    `<script src="${REACT_DOM}"></script>`,
    `<script src="${DAYJS}"></script>`,
    '<script>',
    "const text = 'React ' + React.version + ', dayjs ' + dayjs('2026-09-30').format('YYYY');",
    "ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('p', { id: 'rendered' }, text));",
    '</script>',
].join('\n');

test('html block: loads a real script from jsDelivr, unpkg and cdnjs (#409)', async ({ liveRun }) => {
    const { page } = liveRun;

    // The fence lets only the app and the identity through. For this test, these three
    // files too: the context is shared by the worker's other specs, so take them out again.
    const urls = [REACT, REACT_DOM, DAYJS];
    const allow = (route: Route) => route.continue();
    for (const url of urls) await page.context().route(url, allow);
    const title = `Html CDN ${Date.now()}`;
    try {
        await createNote(page, { title, body: 'Intro' });
        await page.keyboard.press('Enter');
        await pastePlainText(page, '```html\n' + SOURCE + '\n```');

        const frame = activeEditor(page).frameLocator('iframe[title="HTML preview"]');
        await expect(frame.locator('#rendered')).toHaveText('React 18.3.1, dayjs 2026', { timeout: 30_000 });
        // Close the note while the CDN is still allowed: a later spec that changes the
        // theme (emulateMedia) would otherwise reload its frame and trip the fence.
        await page.getByRole('button', { name: `Close ${title}` }).click();
        await expect(page.locator('iframe[title="HTML preview"]')).toHaveCount(0);
    } finally {
        for (const url of urls) await page.context().unroute(url, allow);
    }
});
