import { providerCliBins } from "./cli";

const SEGMENT = /&&|\|\||[;|&\n(){}`]/;
const WRAPPERS = new Set(["env", "nohup", "time", "command", "exec", "nice", "sudo", "timeout", "gtimeout"]);
const HARMLESS = new Set(["--version", "-v", "-V", "--help", "-h", "version", "help", "login", "logout", "status", "update"]);

const unquote = (word: string): string => word.replace(/^["']|["']$/g, "");

/** The provider CLI a shell command runs as a command, if any; `claude --version` and the like don't count. */
export function providerCliInvocation(command: string): string | undefined {
  const bins = providerCliBins();
  for (const segment of command.split(SEGMENT)) {
    const words = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
    while (words.length > 0) {
      const word = words[0]!;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) words.shift();
      else if (WRAPPERS.has(word)) {
        words.shift();
        while (words[0] && (words[0].startsWith("-") || /^\d+[smhd]?$/.test(words[0]))) words.shift();
      } else break;
    }
    const name = words[0]?.split("/").pop();
    if (name && bins.includes(name) && !HARMLESS.has(words[1] ?? "")) return name;
  }
  return undefined;
}

export const providerCliAdvice = (name: string): string =>
  `"${name}" is a provider CLI. To run work on another provider or model, create a Telar session with sessions_create (provider, model) and task it; do not run the CLI from a shell.`;
