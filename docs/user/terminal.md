# Terminal

Telar has a real terminal in the panel. It runs your own shell with your usual startup files, so editors, progress bars and prompts work as they do in any terminal app. Anything that keeps running, like a dev server or a watcher, belongs here.

The terminal exists only in the desktop app. In a browser or on the iPhone you can read a run's output, but you can't open a shell.

## Opening one

Open the Terminal tab in a conversation's panel (see [The panel](panel.md)). A new shell starts in that session's checkout: its worktree, or the project folder for a session that works in the project checkout.

The Terminal tab holds a strip of shells. While a shell has focus, ⌘T opens another, ⌘W closes it and ⌘1–⌘9 jump between them. Add a second Terminal tab if you want two shells side by side.

## Run configurations

A run configuration is a saved command for the project, such as "Dev server: bun run dev". Create and run them from the Run control at the top of the conversation. Each has:

- a name and an icon,
- the command,
- a working directory, relative to the session's checkout,
- an optional readiness check: an address Telar watches to know the server is up,
- environment variables. Mark a variable as secret and Telar never shows its value again, and hides it in the output.

A terminal is a shell that stays open after its command finishes. Running a configuration types its command into that configuration's idle terminal, or opens a new one if there isn't one free ("Dev server #2" when the first is still busy). The tab's dot shows whether a command is running or the shell is idle, and the last exit code if it failed. If its port is already in use, Telar warns you but doesn't stop it. Stop a command with Ctrl-C or by closing the tab; the tab's run-again button runs the last command again in the same shell.

## Agents and terminals

Agents open terminals for anything long-running, instead of leaving it hidden in the background. A terminal an agent opens belongs to its session and appears in the Terminal tab, without switching what you're looking at. Agents can type commands into their terminals, read the output, wait for a command to finish or a server to come up, and close them. An agent can also save a run configuration for the project, or start one of yours.

If you close a terminal an agent opened, the agent is told on its next turn that you closed it, and not to reopen it unless you ask.

## Closing

Closing a terminal ends everything running in it, including child processes, and asks first if a command is still running. A terminal whose shell has ended keeps its tab, so you can read its last output, until you close it.

Terminals are tied to their session:

- They survive switching conversations and reloading the window.
- Settling a session closes all its terminals, including shells you opened.
- Quitting Telar ends every terminal. If something is still running, Telar lists it and asks before quitting.

## What's not obvious

- Every session has its own terminals. A shell opened in one conversation doesn't appear in another, even on the same project.
- A session row in the rail shows how many terminals it has open, and its menu can close them all.
- A shell starts where the session works, not where you last were in another shell.
