# Architecture

## Processes

```
Telar.app (Electron main)
 ├─ telar-engine   the engine + an embedded worker. Owns all state (SQLite journal, TELAR_HOME) and serves the static cockpit.
 └─ renderer       the cockpit, plus WebContentsViews for the integrated browser
iPhone app ──HTTP──▶ the engine's network listener, /v2 (and /api/<path> as an alias until 2027-01-31)
providers (claude, codex, opencode) are child processes of the worker
```

- The engine listens on loopback with a per-boot token written to `<TELAR_HOME>/engine/engine.json`, and on its network listener, which the desktop binds to the same stable port the cockpit has always had (127.0.0.1, or 0.0.0.0 when remote access is on).
- Desktop main starts the engine, waits on `/v2/health`, then loads the cockpit from the network listener at `http://127.0.0.1:<port>/`.
- Electron main owns the integrated browser's tabs, views and CDP; the cockpit only draws and attaches to them through the preload bridge. Never add a second, renderer-owned browser: agents would drive tabs the person can't see.
- A turn goes: cockpit → engine `/v2` → queued in the journal → claimed by the worker → driver → provider. The worker streams observations back into the journal, and the cockpit folds them into the transcript.
- The engine gates every request itself (`decideAccess`): a paired device's bearer or cookie, the desktop shell's host token (sent as `x-telar-host` only to its own loopback origin), or a simulator stream ticket. The engine token opens nothing on the network listener.

### Notifications reach every device

No device holds back another's alert. Each copy, the APNs push and the Mac banner, is posted under `alertId(sessionId)`, and a read receipt (`POST /v2/sessions/:id/read`) clears them all: the engine sends its shell a dismiss and its phones a background `read` push. A Mac showing another host's alerts clears them when that host reports the session read.

### Mac notification sounds

NotificationCenter on macOS 26 finds a Developer ID app's custom banner sound only in `~/Library/Sounds`: copies in `Contents/Resources` or an app group container play the default alert. Desktop main copies Felt's `telar-felt-*.caf` files there at startup under the names the banner uses. It caches each name's lookup until it restarts, so a name that once missed keeps playing the default, and a cached file that is deleted plays nothing.

### Popups over the integrated browser

A browser tab is a native view above the cockpit, so HTML can't cover it. While a tab view is shown, the `ui/` popover, menu, select and context menu portal into the overlay layer instead: a same-origin child the cockpit opens with `window.open('', 'telar-overlay')`, which desktop main adopts as a transparent `WebContentsView` (`windows/overlay-layer.js`). It is one React tree in one renderer. Dialogs, sheets, toasts and the address list still freeze the tab into a picture.

- The view covers only the popups' bounding box, so clicks around them reach the page. The overlay document keeps the cockpit's coordinates. Its content sits in a wrapper translated by the view's origin. Device emulation keeps its layout viewport the cockpit's size even when the view is small, so `vw`, `vh` and media queries in popups match the cockpit. A viewport sized to the view would shrink a `70vh` picker the moment it shows. Translating `<html>` instead breaks floating-ui's clipping.
- floating-ui converts a cockpit anchor's rect through `window.frameElement`, so the cockpit reports a probe that sits at its origin inside the overlay. An anchor without an element (a context menu's point) can't be converted that way, so `ui/context-menu` passes one tied to its trigger. A select aligned to its item mixes the trigger's cockpit rect with its own overlay rect. That holds only because it measures once, as it opens, when the overlay is unshifted. A select opened from inside another overlay popup can land off by that popup's offset.
- floating-ui clips to the visual viewport, and the shown overlay's viewport starts at the view's origin. Any re-position after showing (a font swap, content growing) would then flip or shrink the popup into the box it already has. So the overlay window's `visualViewport` reports the cockpit window, in the overlay's shifted coordinates.
- The overlay shows a popup only when it is ready. base-ui has placed it (until then it is transparent at 0,0), the overlay document's fonts have loaded (it loads the cockpit's web fonts on its own), and its rect has held for two frames. The first frame on screen is then the final one.
- base-ui only listens for outside presses in the popup's own document. The layer replays cockpit presses there, and main reports a press on a tab, seen as focus moving to another view in the same window. Showing the overlay gives it the keys.

## Domains

A domain is one feature, and it has the same name in every app:

| Area | Domains |
| --- | --- |
| Core | `sessions` `turns` `projects` `worktrees` |
| Agents | `providers` `agent-tools` `plugins` `computer-use` |
| Workspace | `files` `git` `github` `terminal` `browser` `simulators` |
| Access | `remote` `hosts` `push` |
| Experience | `appearance` `settings` `dictation` `prompts` |
| Operations | `usage` `schedules` `storage` `updates` |

The cockpit has four UI-only features with no engine domain: `commands`, `composer`, `transcript` and `panel`.

### Shape of a domain

```
apps/engine/src/domains/<name>/
  index.ts      the domain's public API: the only file other code may import
  store.ts      state and persistence, through the kernel
  routes.ts     /v2 HTTP routes (zod-validated)
  tools.ts      agent tools, if the domain exposes any
  *.ts          logic, one concern per file
  *.test.ts     next to the file it tests

apps/web/src/features/<name>/
  index.ts  components/  hooks/  api.ts (typed engine calls)  *.ts (pure logic)  *.test.ts(x)
  server.ts + server/   Node-only code for /api routes; never imported by the client bundle

packages/engine-client/src/<name>/   schema.ts (zod)  client.ts (EngineClient methods)
apps/ios/TelarMobile/Features/<Name>/
```

A feature can have a second entry when the main index would pull too much into eager code. The one that exists is `features/sessions/cockpit`, which is loaded lazily.

### Around the domains

- **Engine:**
  - `src/` root: `main.ts` (process entry), `daemon.ts` (wiring only: stores, routes, timers) and `state.ts` (`EngineStore`, which only builds the domain modules; callers use the modules directly).
  - `platform/`: `kernel/` (commands, the journal, commit hooks), `db/` (the SQLite execution store), `http/` (router, auth, params), `git/`, `fs/`, `process/`, `diagnose/`.
  - `drivers/`: `claude/`, `codex/`, `opencode/` behind `contract.ts`.
  - `worker/`: claim loop, execute, leases, supervisor.
- **Contract:** `packages/engine-client/src/` has one folder per domain, plus `protocol/` (the shared entities, events and items) and `platform/` (the client, transport and errors).
- **Web:**
  - `src/app/`: thin pages, plus the `/api` routes that forward to the engine;
  - `src/ui/`: the design system and generic hooks (`usePoll`, `useNow`, `useListNav`);
  - `src/platform/`: engine transport, desktop bridge, perf marks;
  - `src/test/`: shared test helpers only.
- **Desktop:** `src/{main,browser,terminal,login,store,handoff,preload,windows,dev}`, `test/`, `scripts/`, `assets/`.
- **iOS:** `TelarMobile/{Features,Platform,UI}`.

## Rules

1. No loose files in a `src/` root, except the engine's `main.ts`, `daemon.ts`, `state.ts` and the cockpit's `proxy.ts`. Every file belongs to a domain, `platform`, or `ui`.
2. A domain is imported only through its `index.ts` (or its `server.ts` for Node-only code). `platform` and `ui` never import a domain.
3. Engine domains don't call each other's internals. Cross-domain effects go through kernel hooks (`beforeCommit`, `afterCommit`, `onSessionDeleted`), wired in `daemon.ts`.
4. No file over 800 lines, no function over 150. `check:source` enforces this against the merge base.
5. Anything that crosses a process boundary is declared in `packages/engine-client`, once. Cockpit features reach the engine only through their `api.ts`.
6. Any phone build works with any host back to the oldest one in `packages/engine-client/test/fixtures/hosts`, and the reverse. A field a host may not send is optional; an endpoint a host may not serve is feature-detected by its 404 and its feature turns off. Only connecting and listing sessions are never optional. Every host reports `appVersion` 0.1.0, so gate on what the host answers, not its version. `apps/engine/scripts/record-host-fixture.ts`, copied onto an old tag, records a host's fixture; dropping one is a declared break.

## Headless

The engine serves the cockpit: `TELAR_STATIC_DIR` (the exported `apps/web/out`, packaged as `Resources/cockpit`) is served on both listeners, public and cached by name (`/_next/static` immutable, html revalidated). A real session, solo, new-session or host URL gets its `_` placeholder page; the cockpit reads the real ids from `usePathname`, which Next initialises from `window.location`, so the address, not the placeholder, is what it sees. `cockpit-served.electron-test.js` proves it in a real Chromium.

- The cockpit calls the engine's own `/v2/**` paths on its origin through `httpTransport`; there is no Next server in production. `bun run dev` runs Next dev behind the engine's network listener, which the dev launcher starts on a free loopback port and Next's `rewrites` forward `/v2/**` to.
- Who is calling comes from the connection, not from a server in front: `callerOf(request)` is the host on loopback and for the host token, a paired device for a bearer or cookie.
- `/api/<path>` is served as `/v2/<path>` for released phones and older hosts, with a few phone-only paths in `platform/http/legacy.ts`. Remove both on 2027-01-31.
- Left: move iOS to `/v2` behind `ping.proto`, Linux-clean engine, terminals and the browser in the engine, the CLI, distribution.

The security invariants for the move are in `security.md`.
