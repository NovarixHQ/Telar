import fs from "node:fs";
import path from "node:path";

export type RunShellSpec = {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
};

function isCmd(program: string): boolean {
  return /^(?:.*[\\/])?cmd(?:\.exe)?$/i.test(program);
}

type EnvLike = Readonly<Record<string, string | undefined>>;

export function resolveShell(config: { command: string }, platform: NodeJS.Platform, env: EnvLike = {}): RunShellSpec {
  if (platform === "win32") {
    const comspec = env.ComSpec || env.COMSPEC || "cmd.exe";
    return isCmd(comspec)
      ? { file: comspec, args: ["/d", "/s", "/c", `"${config.command}"`], windowsVerbatimArguments: true }
      : { file: comspec, args: ["-c", config.command], windowsVerbatimArguments: false };
  }
  return { file: "/bin/sh", args: ["-c", config.command], windowsVerbatimArguments: false };
}

export type ShellKind = "zsh" | "bash" | "fish" | "posix" | "cmd" | "pwsh" | "other";

export type InteractiveShell = {
  file: string;
  args: string[];
  env: Record<string, string>;
  kind: ShellKind;
  integrated: boolean;
};

function shellKind(program: string): ShellKind {
  const name = path.basename(program).toLowerCase().replace(/\.exe$/, "");
  if (name === "zsh" || name === "bash" || name === "fish") return name;
  if (name === "cmd") return "cmd";
  if (name === "pwsh" || name === "powershell") return "pwsh";
  if (["sh", "dash", "ksh", "mksh", "ash"].includes(name)) return "posix";
  return "other";
}

const OSC = "\x1b]133;";
const BEL = "\x07";

const ZSH_HOOKS = [
  "__telar_ran=",
  `__telar_preexec() { __telar_ran=1; builtin print -n '\\e]133;C\\a'; }`,
  `__telar_precmd() { local s=$?; [[ -n $__telar_ran ]] && builtin print -n "\\e]133;D;$s\\a"; __telar_ran=; builtin print -n '\\e]133;A\\a'; }`,
  "precmd_functions=(__telar_precmd $precmd_functions)",
  "preexec_functions=(__telar_preexec $preexec_functions)",
].join("\n");

function zshFile(name: string, last: string): string {
  return [
    "TELAR_ZDOTDIR=$ZDOTDIR",
    "ZDOTDIR=${TELAR_USER_ZDOTDIR:-$HOME}",
    `[[ -f $ZDOTDIR/${name} ]] && builtin source $ZDOTDIR/${name}`,
    ...(name === ".zshenv" ? ["TELAR_USER_ZDOTDIR=$ZDOTDIR"] : []),
    "ZDOTDIR=$TELAR_ZDOTDIR",
    last,
  ].join("\n");
}

const ZSH_FILES: Record<string, string> = {
  ".zshenv": zshFile(".zshenv", ""),
  ".zprofile": zshFile(".zprofile", ""),
  ".zshrc": zshFile(".zshrc", ZSH_HOOKS),
  ".zlogin": zshFile(".zlogin", "ZDOTDIR=${TELAR_USER_ZDOTDIR:-$HOME}"),
};

const BASH_INIT = [
  "[ -f /etc/profile ] && . /etc/profile",
  'for __telar_f in ~/.bash_profile ~/.bash_login ~/.profile; do [ -f "$__telar_f" ] && { . "$__telar_f"; break; }; done',
  "unset __telar_f",
  `__telar_prompt() { local s=$?; printf '\\033]133;D;%s\\007\\033]133;A\\007' "$s"; return $s; }`,
  'PROMPT_COMMAND="__telar_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
].join("\n");

const FISH_INIT = [
  "function __telar_preexec --on-event fish_preexec; printf '\\e]133;C\\a'; end",
  "function __telar_postexec --on-event fish_postexec; printf '\\e]133;D;%s\\a' $status; end",
  "function __telar_prompt --on-event fish_prompt; printf '\\e]133;A\\a'; end",
].join("; ");

function writeIfChanged(file: string, content: string): void {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
  }
  fs.writeFileSync(file, content, { mode: 0o600 });
}

function zshDir(dir: string): string {
  const zdot = path.join(dir, "zsh");
  fs.mkdirSync(zdot, { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(ZSH_FILES)) writeIfChanged(path.join(zdot, name), `${content}\n`);
  return zdot;
}

function bashInit(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "init.bash");
  writeIfChanged(file, `${BASH_INIT}\n`);
  return file;
}

function defaultProgram(platform: NodeJS.Platform, env: EnvLike): string {
  if (platform === "win32") return env.ComSpec || env.COMSPEC || "cmd.exe";
  return env.SHELL?.trim() || (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
}

export function interactiveShell(options: {
  program?: string;
  pty: boolean;
  platform: NodeJS.Platform;
  env: EnvLike;
  integrationDir: string;
}): InteractiveShell {
  const { platform, env } = options;
  if (!options.pty) {
    const file = options.program ?? (platform === "win32" ? defaultProgram(platform, env) : "/bin/sh");
    const kind = shellKind(file);
    return { file, args: kind === "cmd" ? ["/d", "/q"] : [], env: {}, kind, integrated: false };
  }
  const file = options.program ?? defaultProgram(platform, env);
  const kind = shellKind(file);
  try {
    if (kind === "zsh") {
      const zdot = zshDir(options.integrationDir);
      return { file, args: ["-l", "-i"], env: { ZDOTDIR: zdot, ...(env.ZDOTDIR ? { TELAR_USER_ZDOTDIR: env.ZDOTDIR } : {}) }, kind, integrated: true };
    }
    if (kind === "bash") return { file, args: ["--init-file", bashInit(options.integrationDir), "-i"], env: {}, kind, integrated: true };
  } catch {
    return { file, args: ["-l", "-i"], env: {}, kind, integrated: false };
  }
  if (kind === "fish") return { file, args: ["-l", "-i", "--init-command", FISH_INIT], env: {}, kind, integrated: true };
  if (kind === "posix") return { file, args: ["-l"], env: {}, kind, integrated: false };
  if (kind === "pwsh") return { file, args: ["-NoLogo"], env: {}, kind, integrated: false };
  return { file, args: [], env: {}, kind, integrated: false };
}

function sentinel(kind: ShellKind): string {
  if (kind === "cmd") return `echo ${"\x1b"}]133;D;%errorlevel%${BEL}`;
  if (kind === "pwsh") return 'Write-Host -NoNewline "$([char]27)]133;D;$LASTEXITCODE$([char]7)"';
  if (kind === "fish") return "printf '\\e]133;D;%s\\a' $status";
  return "printf '\\033]133;D;%s\\007' \"$?\"";
}

export function typedCommand(command: string, shell: { kind: ShellKind; integrated: boolean }, pty: boolean): string {
  const enter = pty ? "\r" : "\n";
  const multiline = /[\r\n]/.test(command);
  const body = pty && multiline && (shell.kind === "zsh" || shell.kind === "fish") ? `\x1b[200~${command}\x1b[201~` : command;
  const line = `${body}${enter}`;
  return shell.integrated ? line : `${line}${sentinel(shell.kind)}${enter}`;
}

export type ShellMarker = { kind: "prompt" } | { kind: "busy" } | { kind: "done"; exitCode?: number };

const ESC = "\x1b";
const MARKER = new RegExp(`${ESC}\\]133;([ACD])(?:;([^${BEL}${ESC}]*))?(?:${BEL}|${ESC}\\\\)`, "g");

export function splitMarkers(text: string): Array<string | ShellMarker> {
  if (!text.includes(OSC)) return [text];
  const parts: Array<string | ShellMarker> = [];
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[1] === "A") parts.push({ kind: "prompt" });
    else if (match[1] === "C") parts.push({ kind: "busy" });
    else {
      const code = Number.parseInt(match[2] ?? "", 10);
      parts.push(Number.isFinite(code) ? { kind: "done", exitCode: code } : { kind: "done" });
    }
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
