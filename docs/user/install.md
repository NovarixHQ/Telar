# Install

Telar is a desktop app for Apple-silicon Macs and for Linux (x64 and arm64, see [Linux](#linux)). It doesn't bring its own agent: it drives the coding agents you already have on the Mac (Claude Code, Codex and OpenCode). Install at least one of them and sign in to it before you start.

## First run

1. Install Telar and open it.
2. Install a provider's CLI and sign in with it the usual way, in your own terminal. See [Providers](providers.md).
3. Add a project and start a session.

Telar keeps its data in its own folder on the Mac. On first launch it creates that folder, and after that it only opens the one it created. If the folder is on a drive that isn't plugged in, or has moved, Telar waits and says so. It never creates a fresh, empty one on its own. Plug the drive back in and Telar carries on. Starting a new store instead has to be confirmed on purpose.

## Linux

Linux builds come in two formats for each of x64 and arm64: `Telar-<version>-linux-<arch>.AppImage` and `Telar-<version>-linux-<arch>.deb`.

- **AppImage**: make it executable and run it. It updates itself.
- **.deb**: `sudo apt install ./Telar-<version>-linux-<arch>.deb`. It adds a menu entry and a `telar` command. Upgrade it by installing the newer file; it has no in-app updater, and Settings says so.

If Telar won't start and the error mentions the sandbox, your distribution restricts unprivileged user namespaces (Ubuntu 24.04 and newer do, through AppArmor). Allow them for Telar in your AppArmor settings, or start it with `--no-sandbox`, which turns Chromium's sandbox off for the app.

Opening a `telar://app/...` link opens Telar at that page, starting it first if it isn't running. The .deb registers the link type when installed; an AppImage registers it only once a desktop integration tool adds it to your menu.

Not available on Linux: Computer use, iOS simulators, window translucency, the quick-composer shortcut and custom notification sounds. Everything else, including terminals and the browser, works.

On a machine with no desktop, use [Running Telar without the app](headless.md) instead.

## Adding a project

A project is a folder Telar works in, usually a git repository. Add one from the rail or the command palette (⌘K, or Ctrl+K on Linux → Add project):

- **Local folder**: browse to a folder already on the Mac.
- **Git URL** or **GitHub repository**: Telar clones it into a folder you pick. A GitHub repository can be written as `owner/repo`.

Other forges show up in the list but aren't set up yet. Clone those yourself and add them as a local folder.

A project that isn't a git repository still works, but its sessions can't have worktrees of their own. See [Sessions](sessions.md).

## Checking your providers

Settings → Providers lists every login Telar found, with its CLI version and whether it's ready. A provider that isn't installed appears under "Not on this machine" with a hint on how to install it. After installing or signing in, choose Re-check.

Telar looks for each CLI where your own terminal would find it: on your `PATH` first, then in the usual install folders. If a CLI lives somewhere unusual, set `CLAUDE_CODE_EXECUTABLE`, `CODEX_BIN` or `OPENCODE_BIN` to its full path.

## Next steps

- [Sessions](sessions.md): local checkouts and worktrees.
- [Composer](composer.md): models, effort and access.
- [iPhone](iphone.md) and [Remote access](remote-access.md): reaching the Mac from elsewhere.
- [Updating](updating.md): Telar updates itself.
