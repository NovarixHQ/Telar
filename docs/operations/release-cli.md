# Releasing the CLI

`telar` ships two ways from `apps/cli`: a single-executable archive per platform (used by `install.sh` and `telar update`) and an npm package (`npx telar@latest`). Nothing publishes by itself; every publishing step below is the owner's.

## The archives

`bun run --cwd apps/cli build:sea [--version <v>]` makes `dist/release/telar-<version>-<os>-<arch>.tar.gz` and its `.sha256` for the machine it runs on. The archive holds the Node single executable `telar` and, beside it, `node_modules/` with `node-pty` (this platform's prebuild only) and the agent SDK with its platform binary. A single executable can only import built-ins, so the build rewrites the SDK import to `require` it from that folder.

The MCP bridge starts the agents' tool servers by re-running `process.execPath` with the script path; in the executable that is `telar` itself, so `main.ts` must keep the bridge check as its first statement.

`cli-build.yml` builds linux-x64 (`ubuntu-latest`), linux-arm64 (`ubuntu-24.04-arm`) and darwin-arm64 (`macos-latest`), runs `apps/cli/scripts/smoke.sh` on each (`version`, `doctor`, `serve`, `pair`, SIGTERM exits 0) and uploads the archives as workflow artifacts. A pull request touching `apps/cli` runs it as a dry run. A `cli-v<version>` tag or a manual run builds only what is on `main`; the manual run takes a channel: `stable` uses the version in `apps/cli/package.json`, `nightly` adds `-nightly.<run number>`. The macOS binary is ad-hoc signed only.

## Where the archives go

The download base URL is the only host setting (`TELAR_DOWNLOAD_BASE`, `--base`, and `<install URL>` in the docs). Serve these files under it:

```
<base>/stable                     text: the current stable version
<base>/nightly                    text: the current nightly version
<base>/<version>/telar-<version>-<os>-<arch>.tar.gz
<base>/<version>/telar-<version>-<os>-<arch>.tar.gz.sha256
<base>/install.sh                 scripts/install.sh
```

To release: download the artifacts of a green `main` run, upload them under `<base>/<version>/`, then write the version into `<base>/stable` (or `/nightly`). Writing that file last is what makes installs and `telar update` see the release. `scripts/install.sh` has a placeholder host and refuses to run until one is set.

## The npm package

`apps/cli/package.json` is the package `telar`. `prepack` builds `dist/telar.mjs` (a Node bundle with a `#!/usr/bin/env node` line); `node-pty` and the agent SDK are its only dependencies, everything else is bundled. Check what would ship with `cd apps/cli && npm pack --dry-run`. Publish with `npm publish` from `apps/cli`, using an account that owns the name. Bump `version` in `apps/cli/package.json` first; it is also the archives' stable version.

## Traps

- The service unit must not set `ManagedOOMPreference`, `CPUWeight` or `IOWeight`: on Fedora with GNOME, `uresourced` and systemd re-apply each other's changes and pin a CPU core.
- `telar update` runs the old version's code and is detached (`systemd-run --user` on a service install) so that restarting the service cannot kill it. Do not move it into the service's own cgroup.
- The engine lock is pid-based; a lock left by the same pid (a container restart) counts as stale.
- The database snapshot is taken before the trial starts because a new version may migrate it; a rollback restores it.
