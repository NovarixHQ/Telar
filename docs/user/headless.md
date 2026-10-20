# Running Telar without the app

`telar` runs the engine on a machine with no desktop app, such as a Linux box or a spare Mac. Other computers, browsers and the iPhone connect to it.

## Install

On Linux (x64, arm64) or an Apple-silicon Mac:

```sh
curl -fsSL <install URL>/install.sh | sh
curl -fsSL <install URL>/install.sh | sh -s -- --channel nightly
```

It needs only `sh`, `tar`, `curl` or `wget`, and `sha256sum` or `shasum`. On Linux, `telar` itself also needs `libatomic` (`sudo apt install libatomic1` on Ubuntu and Debian; slim and container images often lack it); the installer stops and says so if it is missing. It checks the download's checksum, unpacks it under `~/.telar/runtime/versions/<version>` and links `~/.local/bin/telar`. Add `--version <v>` to pick one. With Node 24 or newer, `npx telar@latest <command>` works too, without installing anything.

From a checkout, build with `bun run --cwd apps/cli build` and run `node apps/cli/dist/telar.mjs`.

## Commands

- `telar serve [--host <addr>] [--port <n>] [--tailscale-serve]` runs the engine in the foreground. It listens on `127.0.0.1:7420` unless you pass `--host` (use `0.0.0.0` for your network). Stop it with Ctrl-C; running agents stop with it.
- `telar pair [--tailscale] [--name <device>] [--scopes <list>] [--expires <dur>]` prints a one-time link, an 8-digit code and a QR code, then waits for the device. The pairing expires after five minutes. `--scopes` is a list from `read`, `write`, `admin` (default: all); `--expires` ends the paired session after a duration such as `12h` or `7d`.
- `telar auth session list` shows paired sessions; `telar auth session revoke <id>` cuts one off, and `revoke --all-others [--keep <id>]` cuts off the rest.
- `telar doctor` checks the engine, its address, each agent CLI and whether it is signed in, terminals, the browser and Tailscale.
- `telar browser setup [--dry-run]` makes the host's browser launchable: it downloads Chromium into the data folder, installs the system libraries it needs (apt or dnf, using `sudo` for those steps only) and, on Ubuntu, adds an AppArmor profile that lets only that Chromium use user namespaces. `--dry-run` prints the steps and changes nothing.

Data lives in `$XDG_DATA_HOME/telar` (`~/.local/share/telar`); change it with `--home <dir>` or `TELAR_HOME`. It is never the desktop app's folder.

- `telar service install|status|restart|uninstall [--host <addr>] [--port <n>] [--tailscale-serve]` keeps the engine running in the background and starts it at login. On Linux it is a systemd user service; `install` also turns on linger so it survives logging out (if that needs root it prints the `sudo loginctl enable-linger` command). On a Mac it is a LaunchAgent. Logs: `journalctl --user -u telar -f` on Linux, `<data dir>/logs/engine.log` on a Mac. Stopping the service stops the agents it started.
- `telar update [--channel stable|nightly] [--version <v>]` installs a newer version. It stops the engine, saves a copy of the database under `<data dir>/backups`, tries the new version, and only then switches to it. If the new version does not come up healthy, it puts the old version and the saved database back. It is safe to run from inside a Telar session: the update carries on after the engine restarts.

## Signing in to agents

Sign in on the host itself, over SSH if needed: `claude auth login`, `codex login`, `opencode auth login`, `agent login`. `telar doctor` shows which are signed in. When a login wants a browser, open the link it prints on your own computer and paste the code back into the SSH session.

## The browser on a host

With no desktop app attached, the engine runs its own Chromium and shows it in the panel as a live view you can click and type into; agents drive the same pages. Run `telar browser setup` once to download Chromium and prepare the host. This browser has no extensions (so no password-manager fill), no passkeys or hardware keys, and no picture-in-picture; sites see a headless Chromium. When a desktop app is attached to the engine, its browser is used instead.

## Using a host from the desktop app

Settings → Connections → **Run Telar on this Mac** is on by default. Turn it off and the app stops its own engine and shows another computer's Telar instead: its projects, sessions, terminals and browser. The first time, paste the link `telar pair` prints on that computer. The app restarts when you switch, and switching back starts the engine on this Mac again. **Forget** drops the pairing.

### Over SSH

In Settings → Connections, type `user@host` (or a name from your `~/.ssh/config`) instead of a pairing link, in **Add a computer** or in the field that **Run Telar on this Mac** shows. The app signs in with your own `ssh` and agent, and Telar never stores a key. On that computer it installs `telar` under `~/.telar/runtime` if it is missing, starts it as a service, forwards a port on this Mac to it, and pairs through that port with full access. The computer then behaves like any other.

What is not obvious:
- Sign in must work without a prompt: load the key in your agent (`ssh-add`) and run `ssh user@host` once in Terminal to trust the host.
- The installer needs the download address this build was released with. If it has none, install `telar` on the other computer yourself and use its pairing link.
- The port is forwarded as long as the app runs; it reconnects after a dropped connection or a wake from sleep. Forgetting the computer closes it.
- The other computer needs systemd user services (Linux) or launchd (a Mac), because `telar service install` starts it.

What is not obvious, for both ways:
- The pairing stays in the app, never in the window. Nothing on this Mac runs the agents: the browser, terminals, computer use and simulators are the host's. This Mac still shows the host's notifications; one read on another client closes here too. A paired device with view-only access can't approve from a notification; Approve opens the session instead.
- Folders you pick are folders on the host.
