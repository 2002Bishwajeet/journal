# Journal

![Journal Banner](public/banner.webp)

A premium local-first journaling application designed for effortless writing and privacy. Powered by [Homebase](https://homebase.id)

> [!NOTE]
> Want to try a quick demo? use `john.doe.demo.rocks` as the homebaseId. Password "a" without quotes ;


## Features

- **Local-first Storage**: Built with PGlite (PostgreSQL in the browser) for speed and privacy.
- **PWA Ready**: Fully installable as a Progressive Web App for a native feel on desktop and mobile.
- **Rich Text Editor**: Powerfully extensible block-based editor with Markdown support.
- **Organization**: Nested folders to keep your thoughts structured.
- **AI Powered**: Integrated with local AI capabilities for grammar and paraphrasing.
- **Math & Code**: Full support for LaTeX equations and code syntax highlighting.
- **Dark/Light Mode**: Seamlessly switches between themes for any environment.
- **Search**: Instant full-text search across all your records.

## Installation

### Prerequisites

- **Node 22** or newer (CI runs Node 22) and npm.
- A **GitHub personal access token** with the `read:packages` scope. The Homebase SDK, `@homebase-id/js-lib`, is published on GitHub Packages, which needs a token even for public packages.

### Steps

1. Clone the repository and go into it:

   ```bash
   git clone https://github.com/2002Bishwajeet/journal.git
   cd journal
   ```

2. Tell npm where `@homebase-id` packages come from. Create a file named `.npmrc` in the project root with these two lines (the same ones CI writes):

   ```ini
   @homebase-id:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GH_TOKEN}
   ```

   npm expands `${GH_TOKEN}` from your environment, so the token itself never goes in the file. `.npmrc` is git-ignored; don't commit it. Then export your token in the shell you run npm from:

   ```bash
   export GH_TOKEN=<your token with read:packages>
   ```

3. Install the exact locked dependencies:

   ```bash
   npm ci
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open https://dev.dotyou.cloud:5173. `dev.dotyou.cloud` resolves to `127.0.0.1`, and the dev server uses the Let's Encrypt certificate committed in the repo (`dev-dotyou-cloud.crt`/`.key`), so there is nothing to install or trust. Sign in with a Homebase identity (or the demo identity above).

## Tests

```bash
npm run test   # Vitest integration tests (src/__tests__/)
npm run e2e    # Playwright e2e, hermetic: builds the app and runs it on 127.0.0.1
npm run lint   # ESLint
```

The first `npm run e2e` needs the Playwright browser: `npx playwright install chromium`. The e2e suite never touches `dev.dotyou.cloud` or a real identity; `e2e/README.md` describes every layer, including the live tier against a real Homebase.

## Build

```bash
npm run build
```

This typechecks, then writes the production build to `dist/`.

## Contributing

Read `AGENTS.md` first: architecture, data flow, database schema, sync, code conventions and the testing policy. It is written for both people and coding agents.

## License

AGPL License
