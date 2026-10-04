export const RUN_BRIEFING = [
  "Terminals are shells in the panel that stay open after a command ends. Reuse your session's idle terminals with terminal_run instead of opening new ones; open one with terminal_open only for something that must keep running alongside, such as a dev server, a watcher or a long build. Never start that with a background shell command (run_in_background, a trailing &, nohup).",
  "A project with no run configuration can be given one with run_save_config — a name, a command and optionally an icon — so an empty Run menu is something you can set up yourself rather than a missing capability.",
  "To wait for a terminal — a server to start listening, a command to finish — use terminal_wait, never sleep: it blocks until a pattern matches, it reports ready or the command finishes with its exit code, and tells you WHICH of those happened.",
  "To stop one use terminal_kill, never pkill or killall: the process you would match may be another project's dev server, and killing Telar's own processes (named telar-ui / telar-engine) closes the app. If the person closes a terminal, do not reopen it unless they ask.",
].join(" ");
