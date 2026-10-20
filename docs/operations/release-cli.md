# Releasing the CLI

`telar` ships two ways from `apps/cli`: a single-executable archive per platform (used by `install.sh` and `telar update`) and an npm package (`npx telar@latest`).

## The archives

`bun run --cwd apps/cli build:sea [--version <v>]` makes `dist/release/telar-<version>-<os>-<arch>.tar.gz` and its `.sha256` for the machine it runs on. The archive holds the Node single executable `telar` and, beside it, `node_modules/` with `node-pty` (this platform's prebuild only) and the agent SDK with its platform binary. A single executable can only import built-ins, so the build rewrites the SDK import to `require` it from that folder.

The MCP bridge starts the agents' tool servers by re-running `process.execPath` with the script path; in the executable that is `telar` itself, so `main.ts` must keep the bridge check as its first statement.

`cli-build.yml` builds linux-x64 (`ubuntu-latest`), linux-arm64 (`ubuntu-24.04-arm`) and darwin-arm64 (`macos-latest`), runs `apps/cli/scripts/smoke.sh` on each (`version`, `doctor`, `serve`, `pair`, SIGTERM exits 0) and uploads the archives as workflow artifacts. A pull request touching `apps/cli` runs it as a dry run. The macOS binary is ad-hoc signed only.

## Publishing

A manual run on `main` or a `cli-v<version>` tag on `main` publishes. The manual run takes a channel: `nightly` builds `<package version>-nightly.<run number>`, `stable` the version in `apps/cli/package.json`. A tag is always `stable` and must match that version.

The archives go to the desktop's R2 bucket under `cli/`, which the updates proxy serves without its key. The download base is `$UPDATE_PROXY_URL/cli`, baked into the build (`TELAR_CLI_DOWNLOAD_BASE` at build time) and into the uploaded `install.sh`, so official builds need no `--base`:

```
<base>/stable  and  <base>/nightly    text: the channel's current version
<base>/<version>/telar-<version>-<os>-<arch>.tar.gz(.sha256)
<base>/install.sh
```

The channel file is written last, after the archives and `install.sh`; that write is what makes installs and `telar update` see the release. The run summary prints the install command. A build from a checkout keeps the placeholder base and refuses `install.sh` and `telar update` until one is passed.

## The npm package

`apps/cli/package.json` is the package `telar`. `prepack` builds `dist/telar.mjs` (a Node bundle with a `#!/usr/bin/env node` line); `node-pty` and the agent SDK are its only dependencies, everything else is bundled. Check what would ship with `cd apps/cli && npm pack --dry-run`.

A `cli-v<version>` tag on `main` publishes it from the `npm` job through npm trusted publishing (GitHub OIDC, no token), with provenance. The trusted publisher on npmjs.com is organization `NovarixHQ`, repository `Telar`, workflow `cli-build.yml`, no environment. Bump `version` in `apps/cli/package.json`, merge, then tag that commit.

## Traps

- The service unit must not set `ManagedOOMPreference`, `CPUWeight` or `IOWeight`: on Fedora with GNOME, `uresourced` and systemd re-apply each other's changes and pin a CPU core.
- `telar update` runs the old version's code and is detached (`systemd-run --user` on a service install) so that restarting the service cannot kill it. Do not move it into the service's own cgroup.
- The engine lock is pid-based; a lock left by the same pid (a container restart) counts as stale.
- The database snapshot is taken before the trial starts because a new version may migrate it; a rollback restores it.
