# Edge specs (Cloudflare Pages)

`npm run e2e:edge` runs `e2e/edge/*.spec.ts` against the app as Cloudflare Pages serves it: `public/_headers`, `public/_redirects` and `./functions`, via `wrangler@3.90.0 pages dev dist-e2e` on `http://127.0.0.1:8788` (pinned to the deploy's version). `E2E_EDGE_BASE_URL=https://… npm run e2e:edge` targets a deployed URL instead; then only `request`-based tests run and browser tests skip.

CI runs this project on E2E shard 2 (`.github/workflows/e2e.yml`), and its failures block the PR.

## Screenshot baselines (#1477)

`site-visual.spec.ts` compares every landing site page (home, pricing, download, agents, buy, redeem, privacy, contact) at 1280 and 390, light and dark, full page, with the PNGs in `site-visual.spec.ts-snapshots/`. Reduced motion keeps the entrance reveals and looping demos still, and the hero videos are masked. A page that differs by more than 1% of its pixels fails; the failed run's `playwright-report-2-<attempt>` artifact has the `-expected`, `-actual` and `-diff` images under `test-results/edge/`.

The baselines only ever come from CI's Linux image (another machine's fonts draw them differently, and agents never run Playwright locally). When a PR changes a page's look on purpose, add the `update-snapshots` label to it: `.github/workflows/update-snapshots.yml` regenerates the baselines that changed, commits them to the PR's branch (which starts E2E again) and takes the label off, so the reviewer sees the image diff in the same PR. A new page gets its first baseline the same way: add it to `PAGES` in the spec, then the label.

## Writing a Pages Function spec

Use the `request` fixture — no browser needed to check what the edge returns:

```ts
import { test, expect } from '../fixtures';

test('/share serves OG meta to link-preview bots', async ({ request }) => {
  const html = await (await request.get('/share/<id>/<note>', {
    headers: { 'User-Agent': 'Twitterbot/1.0' },
  })).text();
  expect(html).toContain('property="og:title"');
  expect(html).toContain('property="og:description"');
  expect(html).toContain('property="og:image"');
});
```

Assert the other side too: the same URL with a browser UA returns the unchanged SPA shell (`id="root"`, no injected OG tags).

## Functions that fetch Homebase

Take the upstream base URL from an env binding (`--binding HOMEBASE_URL=…` on `wrangler pages dev`), never a hard-coded host. A spec then points it at either:

- a static server replaying a recorded real response (layer 2, same scrubbed-HAR rules as the recorded layer, #202), or
- a real identity (layer 3) — never a hand-written fake response.
