const TERMINAL_TERM = "xterm-256color";
const UTF8_LOCALE = "en_US.UTF-8";

const isSet = (value: string | undefined) => value !== undefined && value.trim() !== "";

export function terminalEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, TERM: TERMINAL_TERM };
  if (!isSet(env.COLORTERM)) env.COLORTERM = "truecolor";
  if (!isSet(env.LC_ALL) && !isSet(env.LC_CTYPE) && !isSet(env.LANG)) env.LANG = UTF8_LOCALE;
  return env;
}
