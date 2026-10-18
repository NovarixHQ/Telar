# Running Telar without the app

`telar` runs the engine on a machine with no desktop app, such as a Linux box or a spare Mac. Other computers, browsers and the iPhone connect to it.

From a checkout, build once with `bun run --cwd apps/cli build`, then use `node apps/cli/dist/telar.mjs`.

- `telar serve [--host <addr>] [--port <n>] [--tailscale-serve]` runs the engine in the foreground. It listens on `127.0.0.1:7420` unless you pass `--host` (use `0.0.0.0` for your network). Stop it with Ctrl-C; running agents stop with it.
- `telar pair [--tailscale] [--name <device>] [--scopes <list>] [--expires <dur>]` prints a one-time link, an 8-digit code and a QR code, then waits for the device. The pairing expires after five minutes. `--scopes` is a list from `read`, `write`, `admin` (default: all); `--expires` ends the paired session after a duration such as `12h` or `7d`.
- `telar auth session list` shows paired sessions; `telar auth session revoke <id>` cuts one off, and `revoke --all-others [--keep <id>]` cuts off the rest.
- `telar doctor` checks the engine, its address, each agent CLI and whether it is signed in, terminals and Tailscale.

Data lives in `$XDG_DATA_HOME/telar` (`~/.local/share/telar`); change it with `--home <dir>` or `TELAR_HOME`. It is never the desktop app's folder.

Sign in to agents on the host itself, over SSH if needed: `claude auth login`, `codex login`, `opencode auth login`, `agent login`.
