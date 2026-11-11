# Store screenshots

App Store and Google Play listing images, made with the `app-store-screenshots` skill (`.claude/skills/app-store-screenshots/`).

| Folder | Size | Store slot |
| --- | --- | --- |
| `ios/iphone-6.9/` | 1320×2868 | iPhone 6.9" (required) |
| `ios/ipad-13/` | 2064×2752 | iPad 13" |
| `android/phone/` | 1080×1920 | Google Play phone |
| `android/feature-graphic/` | 1024×500 | Google Play feature graphic |

All PNGs are RGB (no alpha), as App Store Connect requires.

## Regenerate

1. **Capture the app.** Start the e2e dev server, then capture. The capture boots the hermetic app (fake `maya.homebase.test` identity, network fenced to `127.0.0.1`), imports the demo notes in `capture/seed/` and screenshots each screen at phone and tablet sizes, light and dark, into `capture/raw/` (git-ignored).

   ```bash
   npx vite --mode e2e --host 127.0.0.1 --port 5174
   ~/.claude/bin/heavy npx playwright test -c brand/store/capture/capture.config.ts store
   ```

2. **Copy the captures into the editor**: `generator/public/screenshots/{apple/iphone,apple/ipad,android/phone}/en/NN.png` (see `capture/stage.sh`).

3. **Edit.** `cd brand/store/generator && npm install && npm run dev`, then open http://127.0.0.1:3100. Copy, layouts and the screenshot paths live in `generator/app-store-screenshots.json`; the editor saves to it. In a headline, `*words*` are set in italic in the emphasis colour.

4. **Export** with the editor's Export bundle button, or for every set at once:

   ```bash
   ~/.claude/bin/heavy npx playwright test -c brand/store/capture/capture.config.ts export
   ```

   This writes the store sizes above, flattened to RGB.

The generator is the skill's template with a `journal` theme (Cream, Night, Sand and Playfair Display from `brand/tokens.css`), `*emphasis*` in headlines, and Next.js/React bumped to patched releases.
