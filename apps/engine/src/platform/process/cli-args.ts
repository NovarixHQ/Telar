export function tokenizeCliArgs(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let started = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"' && /["\\$`]/.test(text[index + 1] ?? "")) current += text[++index];
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else if (char === "\\" && index + 1 < text.length) {
      current += text[++index];
      started = true;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error(`unclosed ${quote} in the extra arguments`);
  if (started) tokens.push(current);
  return tokens;
}

export function cliFlags(args: readonly string[]): Record<string, string | null> {
  const flags: Record<string, string | null> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--") || arg.length === 2) continue;
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      index++;
    } else flags[arg.slice(2)] = null;
  }
  return flags;
}

export const quoteCliArgs = (args: readonly string[]): string =>
  args.map((arg) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'"'"'`)}'`)).join(" ");
