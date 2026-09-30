# Recorded Homebase traffic (layer 2)

`npm run e2e:recorded` replays these recordings, so the `*.recorded.spec.ts` specs run on every PR with no server.

- `<area>/<spec>.recorded.har`: one per spec file (one test per file), responses embedded.
- `meta.json`: the recorded identity, when, and the `@homebase-id/js-lib` version.
- `replay-auth.json`: the recording session's app-origin `localStorage` (token + shared secret). Replay needs it to decrypt the recorded responses. It only ever belongs to a **throwaway identity whose app client is dead** (see below).

Replay (`e2e/support/har.ts`): exact `routeFromHAR` match first, then the same HAR by method + path in recorded order (the SDK encrypts most queries and bodies with a random IV). Anything else fails the test with `HAR_UNMATCHED <METHOD> <path>`. Websockets to the identity are closed, so realtime flows belong in layer 3 (`*.live.spec.ts`). So does any flow that pulls a note it created: the note gets a new random uniqueId on every run, so the pull brings back the recording's copy and fetches a payload the recording never did (see `editor/create-edit.live.spec.ts`).

## When to re-record

After an SDK bump, a backend API change, a change to a recorded spec or the flow it drives, or a `HAR_UNMATCHED` failure. Always re-record the whole suite in one run.

## How

1. Log in to a **throwaway identity**, never your real journal: a local odin-core dev identity such as `frodo.dotyou.cloud`, or the hosted test identity. `E2E_LIVE_IDENTITY=<identity> npm run e2e:login`, or for a fresh Docker identity boot it with `e2e/live/docker.sh up`, then run `live-ci-setup` (see `npm run e2e:live:docker`).
2. `E2E_LIVE_IDENTITY=<identity> npm run e2e:record`. This records every spec inside its own `e2e-<run>-<spec>` folder, writes these files, then runs `scrub-har.mjs` and `check-har.mjs`.
3. **Revoke right away.** For a hosted identity, revoke the Journal app client in its owner console. For Docker, run `e2e/live/docker.sh down`, which destroys the identity and its token. Either way the committed token is dead and decrypts only test data.
4. `npm run e2e:recorded -- --repeat-each=3`, then commit. The PR says which identity was recorded and that its client was revoked.

## Scrub check

`node e2e/support/check-har.mjs` exits 1 and names the file and entry if a HAR has an `authorization`/`cookie`/`set-cookie`/`bx0900` header, a non-empty `cookies` array, a value matching `/Bearer\s|BX0900/i`, or the session's literal token or secret (from `e2e/.auth/live.json` and `replay-auth.json`). `npm run e2e:recorded` runs it first.
